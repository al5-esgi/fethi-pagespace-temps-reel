import type { Server, Socket } from 'socket.io'
import { findDemoProfile } from '../profiles.ts'
import { parseClientOp } from '../store.ts'
import type { CharOp } from './convergence.exemple.ts'
import { DocumentCrdt, parseCharOps } from './document-crdt.ts'
import type { RealtimeMetrics } from './metrics.ts'
import type { CursorState, JoinAck, Member, OperationAck } from './protocol.ts'
import type { RedisState } from './redis-state.ts'
import { RateLimiter } from './security-helpers.ts'

export function registerClusterSocket(io: Server, socket: Socket, shared: RedisState, metrics?: RealtimeMetrics): void {
  const limiter = new RateLimiter(20)
  let sequence = 0
  let tasks = Promise.resolve()
  const enqueue = (work: () => Promise<void>, onError?: (reason: string) => void) => {
    tasks = tasks.then(work).catch((error) => {
      console.error(`[${shared.instance}] ${error.message}`)
      onError?.('etat partage indisponible')
    })
  }
  const allowed = (document: { ownerId: string; collaboratorIds: string[] }) =>
    document.ownerId === socket.data.userId || document.collaboratorIds.includes(socket.data.userId)

  socket.on('join', (room: unknown, ack: JoinAck) => {
    if (typeof ack !== 'function') return
    enqueue(async () => {
      if (typeof room !== 'string' || !room.startsWith('doc:')) return void ack(false, 'room non autorisee')
      const previousRoom = socket.data.room as string | undefined
      if (previousRoom && previousRoom !== room) {
        const previous = await shared.leave(socket.id)
        await socket.leave(previousRoom)
        socket.data.room = undefined
        socket.data.presenceId = undefined
        if (previous) io.to(previousRoom).emit('presence-left', { docId: previous.docId, presenceId: previous.presenceId })
      }
      const docId = room.slice(4)
      const state = await shared.readDocument(docId)
      if (!state || !allowed(state.document)) return void ack(false, 'room non autorisee')
      await socket.join(room)
      const profile = findDemoProfile(socket.data.userId)
      const clientId = typeof socket.handshake.auth.clientId === 'string' && socket.handshake.auth.clientId.length <= 200
        ? socket.handshake.auth.clientId : socket.id
      const member: Member = {
        docId, presenceId: `${socket.data.userId}:${clientId}`, userId: socket.data.userId,
        label: profile?.name ?? socket.data.userId, color: profile?.color ?? '#007AFF',
        position: 0, selectionStart: 0, selectionEnd: 0,
        anchors: { position: null, selectionStart: null, selectionEnd: null },
      }
      const joined = await shared.join(member, socket.id)
      socket.data.room = room
      socket.data.presenceId = member.presenceId
      const latest = (await shared.readDocument(docId))!
      const members = await shared.members(docId, shared.text(latest))
      ack(true, undefined, {
        docId, text: latest.document.blocs[0].text, version: latest.document.history.length,
        selfId: member.presenceId, members, crdtOps: latest.crdtOps, instance: shared.instance,
      })
      if (joined.status === 'joined') socket.to(room).emit('presence-joined', joined.member)
      if (joined.status === 'restored') socket.to(room).emit('presence-restored', joined.member)
    }, (reason) => ack(false, reason))
  })

  const rateAllowed = (ack: OperationAck): boolean => {
    if (limiter.hit()) return true
    ack(false, 'rate limit exceeded')
    socket.disconnect(true)
    return false
  }

  async function apply(docId: string, ops: CharOp[], ack: OperationAck): Promise<void> {
    const room = `doc:${docId}`
    const current = await shared.readDocument(docId)
    if (!current || !socket.rooms.has(room) || !allowed(current.document)) return void ack(false, 'document non rejoint')
    const updated = await shared.apply(docId, ops, socket.data.userId)
    metrics?.acceptedBatch()
    socket.to(room).emit('crdt:op', { docId, ops, by: socket.data.userId })
    const members = await shared.members(docId, shared.text(updated))
    io.to(room).emit('cursors:update', { docId, members })
    ack(true)
  }

  socket.on('crdt:op', (raw: unknown, ack: OperationAck) => {
    if (typeof ack !== 'function' || !rateAllowed(ack)) return
    const packet = raw && typeof raw === 'object' ? raw as { docId?: string; ops?: unknown } : null
    const ops = parseCharOps(packet?.ops)
    if (!packet || typeof packet.docId !== 'string' || !ops) return void ack(false, 'operation CRDT invalide')
    enqueue(() => apply(packet.docId!, ops, ack), (reason) => ack(false, reason))
  })

  socket.on('op', (raw: unknown, ack: OperationAck) => {
    if (typeof ack !== 'function' || !rateAllowed(ack)) return
    const parsed = parseClientOp(raw)
    if (!parsed?.docId || !Number.isSafeInteger(parsed.offset) ||
        (parsed.kind === 'insert' && typeof parsed.text !== 'string') ||
        (parsed.kind === 'delete' && (!Number.isSafeInteger(parsed.length) || parsed.length! < 0))) {
      return void ack(false, 'operation invalide')
    }
    enqueue(async () => {
      const state = await shared.readDocument(parsed.docId!)
      if (!state || !socket.rooms.has(`doc:${parsed.docId}`)) return void ack(false, 'document non rejoint')
      const generator = new DocumentCrdt(`legacy:${shared.instance}:${socket.id}:${++sequence}`)
      generator.loadSnapshot(state.crdtOps)
      const offset = Math.max(0, Math.min(parsed.offset, generator.toString().length))
      const ops = parsed.kind === 'insert' ? generator.insertLocal(offset, parsed.text!)
        : generator.deleteLocal(offset, parsed.length!)
      await apply(parsed.docId!, ops, ack)
      socket.to(`doc:${parsed.docId}`).emit('op', { ...parsed, offset, by: socket.data.userId })
    }, (reason) => ack(false, reason))
  })

  socket.on('cursor:move', (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const cursor = raw as CursorState
    if (![cursor.position, cursor.selectionStart, cursor.selectionEnd].every(Number.isSafeInteger)) return
    enqueue(async () => {
      const room = socket.data.room as string | undefined
      const presenceId = socket.data.presenceId as string | undefined
      if (!room || !presenceId) return
      const docId = room.slice(4)
      const state = await shared.readDocument(docId)
      if (!state) return
      const text = shared.text(state)
      const clamp = (offset: number) => Math.max(0, Math.min(offset, text.toString().length))
      const anchors = cursor.anchors
      const validAnchor = (value: unknown) => value === null || parseCharOps([{ type: 'delete', pos: value }]) !== null
      const normalized: CursorState = { position: clamp(cursor.position),
        selectionStart: clamp(cursor.selectionStart), selectionEnd: clamp(cursor.selectionEnd) }
      normalized.anchors = anchors && [anchors.position, anchors.selectionStart, anchors.selectionEnd].every(validAnchor)
        ? anchors : { position: text.anchorAt(normalized.position),
          selectionStart: text.anchorAt(normalized.selectionStart), selectionEnd: text.anchorAt(normalized.selectionEnd) }
      normalized.position = text.offsetForAnchor(normalized.anchors.position)
      normalized.selectionStart = text.offsetForAnchor(normalized.anchors.selectionStart)
      normalized.selectionEnd = text.offsetForAnchor(normalized.anchors.selectionEnd)
      const member = await shared.cursor(docId, presenceId, socket.id, normalized)
      if (member) socket.to(room).emit('cursor:move', member)
    })
  })

  socket.once('disconnect', () => {
    limiter.stop()
    enqueue(() => shared.disconnect(socket.id))
  })
}
