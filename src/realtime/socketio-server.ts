import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { recordAndApply, type Operation } from '../domain.ts'
import { findDemoProfile } from '../profiles.ts'
import { publishOperation } from '../rest.ts'
import { parseClientOp, type ClientOp, type Store } from '../store.ts'
import { RateLimiter, SECRET, verifyJwtPayload } from './security-helpers.ts'

const SERVER_PORT = Number(process.env.PORT ?? 3000)
const ALLOWED_ORIGINS = [`http://localhost:${SERVER_PORT}`, `http://127.0.0.1:${SERVER_PORT}`]
const MAX_MESSAGES_PER_SECOND = 20
const GRACE_PERIOD_MS = 5_000

interface CursorState {
  position: number
  selectionStart: number
  selectionEnd: number
}

interface Member extends CursorState {
  docId: string
  presenceId: string
  userId: string
  label: string
  color: string
}

interface InternalMember extends Member {
  socketId: string
}

interface RoomState {
  members: Map<string, InternalMember>
  pendingLeave: Map<string, ReturnType<typeof setTimeout>>
}

interface RoomSnapshot {
  docId: string
  text: string
  version: number
  selfId: string
  members: Member[]
}

type JoinAck = (ok: boolean, error?: string, snapshot?: RoomSnapshot) => void
type OperationAck = (ok: boolean, error?: string) => void

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

export function startSocketIoServer(httpServer: HttpServer, store: Store): Server {
  const rooms = new Map<string, RoomState>()
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
    cors: { origin: ALLOWED_ORIGINS },
  })

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? null
    const payload = verifyJwtPayload(token, SECRET)
    if (!payload) {
      next(new Error('unauthorized'))
      return
    }

    socket.data.userId = payload.sub
    next()
  })

  io.on('connection', (socket) => {
    const limiter = new RateLimiter(MAX_MESSAGES_PER_SECOND)
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
      const operation: Operation = {
        type: accepted.kind,
        offset: accepted.offset,
        text: accepted.text,
        length: accepted.length,
        by: accepted.by,
        at: Date.now(),
      }

      recordAndApply(document, operation)
      const state = rooms.get(room)
      const insertedLength = accepted.kind === 'insert' ? accepted.text!.length : 0
      const deletedLength = accepted.kind === 'delete' ? accepted.length! : 0
      const moveOffset = (offset: number) => offset < accepted.offset ? offset
        : accepted.kind === 'insert' ? offset + insertedLength
        : Math.max(accepted.offset, offset - deletedLength)
      for (const member of state?.members.values() ?? []) {
        member.position = moveOffset(member.position)
        member.selectionStart = moveOffset(member.selectionStart)
        member.selectionEnd = moveOffset(member.selectionEnd)
      }
      publishOperation(accepted)
      socket.to(room).emit('op', accepted)
      if (state) io.to(room).emit('cursors:update', {
        docId: accepted.docId,
        members: [...state.members.values()].map(publicMember),
      })
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
  })

  return io
}
