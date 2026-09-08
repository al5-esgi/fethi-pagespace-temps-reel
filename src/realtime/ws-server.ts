import type { IncomingMessage, Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { RateLimiter, SECRET, verifyJwt } from './security-helpers.ts'

const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
const MAX_MESSAGES_PER_SECOND = 20

function extractToken(req: IncomingMessage): string | null {
  const queryToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token')
  if (queryToken) return queryToken

  const protocolHeader = req.headers['sec-websocket-protocol']
  const protocols = typeof protocolHeader === 'string' ? protocolHeader.split(',') : []
  return protocols.map((protocol) => protocol.trim()).find(Boolean) ?? null
}

export interface WebSocketHooks<TInput> {
  parseInput(raw: unknown): TInput | null
  applyInput(input: TInput): void
}

export function startWebSocketServer<TInput>(
  httpServer: Server,
  hooks: WebSocketHooks<TInput>,
): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, done) => {
      if (info.origin && !ALLOWED_ORIGINS.includes(info.origin)) {
        done(false, 403, 'Origin non autorisee')
        return
      }

      const token = extractToken(info.req)
      if (!verifyJwt(token, SECRET)) {
        done(false, 401, 'Token invalide')
        return
      }

      done(true)
    },
  })

  const alive = new WeakMap<WebSocket, boolean>()

  wss.on('connection', (socket) => {
    const limiter = new RateLimiter(MAX_MESSAGES_PER_SECOND)
    alive.set(socket, true)

    socket.on('pong', () => alive.set(socket, true))
    socket.on('close', () => limiter.stop())

    socket.on('message', (data) => {
      if (!limiter.hit()) {
        socket.close(1008, 'rate limit exceeded')
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        socket.send(`echo: ${data.toString()}`)
        return
      }

      const input = hooks.parseInput(parsed)
      if (input) hooks.applyInput(input)
      socket.send(data.toString())
    })
  })

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.terminate()
        continue
      }

      alive.set(socket, false)
      socket.ping()
    }
  }, 30_000)

  wss.on('close', () => clearInterval(heartbeat))
  return wss
}
