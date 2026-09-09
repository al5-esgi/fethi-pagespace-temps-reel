import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { recordAndApply, type Operation } from '../domain.ts'
import { publishOperation } from '../rest.ts'
import { parseClientOp, type ClientOp, type Store } from '../store.ts'
import { RateLimiter, SECRET, verifyJwtPayload } from './security-helpers.ts'

const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
const MAX_MESSAGES_PER_SECOND = 20

type Ack = (ok: boolean, error?: string) => void

function documentIdFromRoom(room: string): string | null {
  return room.startsWith('doc:') ? room.slice('doc:'.length) : null
}

export function isAllowedRoom(store: Store, userId: string, room: string): boolean {
  const documentId = documentIdFromRoom(room)
  if (!documentId) return false
  return store.documents.get(documentId)?.ownerId === userId
}

export function startSocketIoServer(httpServer: HttpServer, store: Store): Server {
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

    socket.on('join', async (room: unknown, ack: Ack) => {
      if (typeof room !== 'string' || !isAllowedRoom(store, socket.data.userId, room)) {
        ack(false, 'room non autorisee')
        return
      }

      for (const joinedRoom of socket.rooms) {
        if (joinedRoom.startsWith('doc:')) await socket.leave(joinedRoom)
      }

      await socket.join(room)
      const documentId = documentIdFromRoom(room)!
      const document = store.documents.get(documentId)!

      ack(true)
      socket.emit('snapshot', {
        docId: document.id,
        text: document.blocs[0]?.text ?? '',
        version: document.history.length,
      })
      socket.to(room).emit('member-joined', socket.data.userId)
    })

    socket.on('op', (raw: unknown, ack: Ack) => {
      if (!limiter.hit()) {
        ack(false, 'rate limit exceeded')
        socket.disconnect(true)
        return
      }

      const parsed = parseClientOp(raw)
      if (!parsed?.docId) {
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
        by: socket.data.userId,
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
      publishOperation(accepted)
      socket.to(room).emit('op', accepted)
      ack(true)
    })
  })

  return io
}
