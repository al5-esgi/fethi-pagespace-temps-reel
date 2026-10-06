import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { recordAndApply, type Operation } from '../domain.ts'
import { findDemoProfile } from '../profiles.ts'
import { publishOperation } from '../rest.ts'
import { parseClientOp, type ClientOp, type Store } from '../store.ts'
import type { CharOp } from './convergence.exemple.ts'
import { DocumentCrdt, parseCharOps } from './document-crdt.ts'
import { registerClusterSocket } from './cluster-handlers.ts'
import type { RealtimeMetrics } from './metrics.ts'
import type { RedisState } from './redis-state.ts'
import type { CursorState, Member, RoomSnapshot, JoinAck, OperationAck } from './protocol.ts'
import { RateLimiter, SECRET, verifyJwtPayload } from './security-helpers.ts'

const SERVER_PORT = Number(process.env.PORT ?? 3000)
const ALLOWED_ORIGINS = [`http://localhost:${SERVER_PORT}`, `http://127.0.0.1:${SERVER_PORT}`]
const MAX_MESSAGES_PER_SECOND = 20
const GRACE_PERIOD_MS = 5_000

interface InternalMember extends Member {
  socketId: string
}

interface RoomState {
  members: Map<string, InternalMember>
  pendingLeave: Map<string, ReturnType<typeof setTimeout>>
}

function publicMember(member: InternalMember): Member {
  const { socketId: _socketId, ...publicValue } = member
  return publicValue
}

function colorFor(value: string): string {
  const palette = ['#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF9500', '#00A67E']
  const hash = [...value].reduce((total, char) => total + char.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

function documentIdFromRoom(room: string): string | null {
  return room.startsWith('doc:') ? room.slice('doc:'.length) : null
}

export function isAllowedRoom(store: Store, userId: string, room: string): boolean {
  const documentId = documentIdFromRoom(room)
  if (!documentId) return false
  const document = store.documents.get(documentId)
  return document?.ownerId === userId || document?.collaboratorIds.includes(userId) === true
}

export function startSocketIoServer(httpServer: HttpServer, store: Store,
  options: { shared?: RedisState; metrics?: RealtimeMetrics; instance?: string } = {}): Server {
  const rooms = new Map<string, RoomState>()
  const texts = new Map<string, DocumentCrdt>()
  function documentText(docId: string): DocumentCrdt {
    let text = texts.get(docId)
    if (!text) {
      text = new DocumentCrdt(`server:${docId}`)
      text.insertLocal(0, store.documents.get(docId)!.blocs[0]?.text ?? '')
      texts.set(docId, text)
    }
    return text
  }
  function getRoomState(room: string): RoomState {
    let state = rooms.get(room)
    if (!state) {
      state = { members: new Map(), pendingLeave: new Map() }
      rooms.set(room, state)
    }
    return state
  }

  const io = new Server(httpServer, {
    pingInterval: 25_000,
    pingTimeout: 20_000,
    cors: { origin: process.env.PUBLIC_ORIGINS?.split(',') ?? ALLOWED_ORIGINS },
  })
  options.metrics?.observe(io)
  if (options.shared) {
    io.adapter(options.shared.adapter())
    options.shared.monitor((member) => io.to(`doc:${member.docId}`).emit('presence-left', {
      docId: member.docId, presenceId: member.presenceId,
    }))
  }

  function applyBatch(docId: string, ops: CharOp[], userId: string): void {
    const document = store.documents.get(docId)!
    const text = documentText(docId)
    for (const op of ops) {
      const change = text.apply(op)
      if (!change) continue
      const operation: Operation = { type: change.kind, offset: change.offset,
        text: change.text, length: change.length, by: userId, at: Date.now() }
      recordAndApply(document, operation)
      publishOperation({ ...change, docId, by: userId })
    }
    const state = rooms.get(`doc:${docId}`)
    for (const member of state?.members.values() ?? []) {
      if (!member.anchors) continue
      member.position = text.offsetForAnchor(member.anchors.position)
      member.selectionStart = text.offsetForAnchor(member.anchors.selectionStart)
      member.selectionEnd = text.offsetForAnchor(member.anchors.selectionEnd)
    }
  }

  function broadcastCursors(docId: string): void {
    const state = rooms.get(`doc:${docId}`)
    if (state) io.to(`doc:${docId}`).emit('cursors:update', {
      docId, members: [...state.members.values()].map(publicMember),
    })
  }

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? null
    const payload = verifyJwtPayload(token, SECRET)
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
      next(new Error('unauthorized'))
      return
    }

    socket.data.userId = payload.sub
    next()
  })

  io.on('connection', (socket) => {
    if (options.shared) {
      registerClusterSocket(io, socket, options.shared, options.metrics)
      return
    }
    const limiter = new RateLimiter(MAX_MESSAGES_PER_SECOND)
    let legacySequence = 0
    socket.on('disconnect', () => limiter.stop())

    socket.on('join', async (room: unknown, ack: JoinAck) => {
      if (typeof ack !== 'function') return
      if (typeof room !== 'string') {
        ack(false, 'room non autorisee')
        return
      }

      const previousRoom = socket.data.room as string | undefined
      const previousPresenceId = socket.data.presenceId as string | undefined
      if (previousRoom && previousRoom !== room && previousPresenceId) {
        const previousState = rooms.get(previousRoom)
        const previousMember = previousState?.members.get(previousPresenceId)
        const previousTimer = previousState?.pendingLeave.get(previousPresenceId)
        if (previousTimer) clearTimeout(previousTimer)
        previousState?.pendingLeave.delete(previousPresenceId)
        previousState?.members.delete(previousPresenceId)
        if (previousMember) {
          socket.to(previousRoom).emit('presence-left', {
            docId: previousMember.docId,
            presenceId: previousPresenceId,
          })
        }
        if (previousState?.members.size === 0) rooms.delete(previousRoom)
        socket.data.room = undefined
        socket.data.presenceId = undefined
      }

      for (const joinedRoom of socket.rooms) {
        if (joinedRoom.startsWith('doc:') && joinedRoom !== room) await socket.leave(joinedRoom)
      }

      if (!isAllowedRoom(store, socket.data.userId, room)) {
        ack(false, 'room non autorisee')
        return
      }

      await socket.join(room)
      const documentId = documentIdFromRoom(room)!
      const document = store.documents.get(documentId)!
      const text = documentText(documentId)
      const clientId =
        typeof socket.handshake.auth?.clientId === 'string'
          ? socket.handshake.auth.clientId
          : socket.id
      const presenceId = `${socket.data.userId}:${clientId}`
      const state = getRoomState(room)
      const existing = state.members.get(presenceId)
      const pendingLeave = state.pendingLeave.get(presenceId)
      const profile = findDemoProfile(socket.data.userId)

      if (pendingLeave) {
        clearTimeout(pendingLeave)
        state.pendingLeave.delete(presenceId)
      }

      const member: InternalMember = {
        docId: documentId,
        presenceId,
        userId: socket.data.userId,
        label: profile?.name ?? socket.data.userId,
        color: existing?.color ?? profile?.color ?? colorFor(presenceId),
        position: existing?.position ?? 0,
        selectionStart: existing?.selectionStart ?? 0,
        selectionEnd: existing?.selectionEnd ?? 0,
        anchors: existing?.anchors ?? { position: null, selectionStart: null, selectionEnd: null },
        socketId: socket.id,
      }

      state.members.set(presenceId, member)
      socket.data.room = room
      socket.data.presenceId = presenceId

      const snapshot: RoomSnapshot = {
        docId: document.id,
        text: document.blocs[0]?.text ?? '',
        version: document.history.length,
        selfId: presenceId,
        members: [...state.members.values()].map(publicMember),
        crdtOps: text.snapshot(),
        instance: options.instance ?? 'solo',
      }

      ack(true, undefined, snapshot)
      if (pendingLeave) socket.to(room).emit('presence-restored', publicMember(member))
      else if (!existing) socket.to(room).emit('presence-joined', publicMember(member))
    })

    socket.on('op', (raw: unknown, ack: OperationAck) => {
      if (typeof ack !== 'function') return
      if (!limiter.hit()) {
        ack(false, 'rate limit exceeded')
        socket.disconnect(true)
        return
      }

      const parsed = parseClientOp(raw)
      if (!parsed?.docId || !Number.isSafeInteger(parsed.offset) ||
          (parsed.kind === 'insert' && typeof parsed.text !== 'string') ||
          (parsed.kind === 'delete' && (!Number.isSafeInteger(parsed.length) || parsed.length! < 0))) {
        ack(false, 'operation invalide')
        return
      }

      const room = `doc:${parsed.docId}`
      const document = store.documents.get(parsed.docId)
      if (!document || !socket.rooms.has(room)) {
        ack(false, 'document non rejoint')
        return
      }

      const accepted: ClientOp = {
        ...parsed,
        offset: Math.max(0, Math.min(parsed.offset, document.blocs[0]?.text.length ?? 0)),
        by: socket.data.userId,
      }
      if (accepted.kind === 'delete') {
        accepted.length = Math.min(accepted.length!, document.blocs[0].text.length - accepted.offset)
      }
      // Compatibilite des tests TP4/TP5 : les offsets sont traduits en positions stables.
      // Le navigateur du TP6 emet directement crdt:op, y compris pour une edition concurrente.
      const text = documentText(parsed.docId)
      const generator = new DocumentCrdt(`legacy:${socket.id}:${++legacySequence}`)
      generator.loadSnapshot(text.snapshot())
      const ops = accepted.kind === 'insert'
        ? generator.insertLocal(accepted.offset, accepted.text!)
        : generator.deleteLocal(accepted.offset, accepted.length!)
      applyBatch(parsed.docId, ops, socket.data.userId)
      socket.to(room).emit('op', accepted)
      socket.to(room).emit('crdt:op', { docId: parsed.docId, ops, by: socket.data.userId })
      broadcastCursors(parsed.docId)
      ack(true)
    })

    socket.on('crdt:op', (raw: unknown, ack: OperationAck) => {
      if (typeof ack !== 'function') return
      if (!limiter.hit()) {
        ack(false, 'rate limit exceeded')
        socket.disconnect(true)
        return
      }
      const packet = raw && typeof raw === 'object' ? raw as { docId?: string; ops?: unknown } : null
      const ops = parseCharOps(packet?.ops)
      if (!packet || typeof packet.docId !== 'string' || !ops) {
        ack(false, 'operation CRDT invalide')
        return
      }
      const room = `doc:${packet.docId}`
      if (!store.documents.has(packet.docId) || !socket.rooms.has(room)) {
        ack(false, 'document non rejoint')
        return
      }
      applyBatch(packet.docId, ops, socket.data.userId)
      options.metrics?.acceptedBatch()
      socket.to(room).emit('crdt:op', { docId: packet.docId, ops, by: socket.data.userId })
      broadcastCursors(packet.docId)
      ack(true)
    })

    socket.on('cursor:move', (raw: unknown) => {
      const room = socket.data.room as string | undefined
      const presenceId = socket.data.presenceId as string | undefined
      if (!room || !presenceId || !raw || typeof raw !== 'object') return

      const state = rooms.get(room)
      const member = state?.members.get(presenceId)
      const documentId = documentIdFromRoom(room)
      const document = documentId ? store.documents.get(documentId) : undefined
      if (!state || !member || !document || member.socketId !== socket.id) return

      const cursor = raw as Partial<CursorState>
      if (![cursor.position, cursor.selectionStart, cursor.selectionEnd].every(Number.isSafeInteger)) return
      const max = document.blocs[0]?.text.length ?? 0
      const clamp = (value: number | undefined) => Math.max(0, Math.min(value ?? 0, max))

      member.position = clamp(cursor.position)
      member.selectionStart = clamp(cursor.selectionStart)
      member.selectionEnd = clamp(cursor.selectionEnd)
      const text = documentText(documentId!)
      const anchors = cursor.anchors
      const validAnchor = (value: unknown) => value === null || parseCharOps([{ type: 'delete', pos: value }]) !== null
      if (anchors && [anchors.position, anchors.selectionStart, anchors.selectionEnd].every(validAnchor)) {
        member.anchors = anchors
        member.position = text.offsetForAnchor(anchors.position)
        member.selectionStart = text.offsetForAnchor(anchors.selectionStart)
        member.selectionEnd = text.offsetForAnchor(anchors.selectionEnd)
      } else {
        member.anchors = { position: text.anchorAt(member.position),
          selectionStart: text.anchorAt(member.selectionStart), selectionEnd: text.anchorAt(member.selectionEnd) }
      }
      socket.to(room).emit('cursor:move', publicMember(member))
    })

    socket.on('disconnect', () => {
      const room = socket.data.room as string | undefined
      const presenceId = socket.data.presenceId as string | undefined
      if (!room || !presenceId) return

      const state = rooms.get(room)
      const member = state?.members.get(presenceId)
      if (!state || !member || member.socketId !== socket.id) return

      const previousTimer = state.pendingLeave.get(presenceId)
      if (previousTimer) clearTimeout(previousTimer)

      const timer = setTimeout(() => {
        const current = state.members.get(presenceId)
        state.pendingLeave.delete(presenceId)
        if (!current || current.socketId !== socket.id) return

        state.members.delete(presenceId)
        io.to(room).emit('presence-left', { docId: member.docId, presenceId })
        if (state.members.size === 0) rooms.delete(room)
      }, GRACE_PERIOD_MS)

      state.pendingLeave.set(presenceId, timer)
    })
  })

  httpServer.on('close', () => {
    for (const state of rooms.values()) {
      for (const timer of state.pendingLeave.values()) clearTimeout(timer)
    }
    rooms.clear()
    texts.clear()
  })

  return io
}
