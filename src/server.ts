import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerRoutes } from './rest.ts'
import { createStore } from './store.ts'
import { startSocketIoServer } from './realtime/socketio-server.ts'
import { RedisState } from './realtime/redis-state.ts'
import { RealtimeMetrics } from './realtime/metrics.ts'
import { registerHttpSecurity } from './security.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)
const INSTANCE = process.env.INSTANCE ?? 'solo'

const store = createStore()
const app = Fastify({ logger: false, bodyLimit: 65_536 })
const shared = process.env.REDIS_URL
  ? new RedisState(process.env.REDIS_URL, process.env.REDIS_NAMESPACE ?? 'editeur-tp7', INSTANCE, store) : undefined
try {
  await shared?.connect()
} catch (error) {
  await shared?.close()
  throw new Error(`Redis configure mais indisponible : demarrage multi-instance refuse (${String(error)})`)
}
const metrics = new RealtimeMetrics(INSTANCE)

await registerHttpSecurity(app)
await app.register(fastifyStatic, { root: join(HERE, '..', 'public'), dotfiles: 'deny' })
registerRoutes(app, store, shared)
const io = startSocketIoServer(app.server, store, { shared, metrics, instance: INSTANCE })
app.addHook('onSend', (_req, reply, _payload, done) => { reply.header('X-Editor-Instance', INSTANCE); done() })
app.get('/api/health', async (_req, reply) => {
  if (shared && !shared.ready) reply.code(503)
  return { status: !shared || shared.ready ? 'ok' : 'degraded', instance: INSTANCE,
    redis: shared ? shared.ready ? 'connected' : 'disconnected' : 'disabled' }
})
app.get('/metrics', async (_req, reply) => {
  if (process.env.NODE_ENV === 'production') return reply.code(404).send({ error: 'route indisponible' })
  reply.type(metrics.registry.contentType)
  return metrics.render(io, shared?.ready ?? false)
})
app.addHook('preClose', () => new Promise<void>((resolve) => io.close(() => resolve())))
app.addHook('onClose', async () => { await shared?.close() })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`[${INSTANCE}] editeur-collaboratif : http://localhost:${PORT}`)
console.log(`[${INSTANCE}] Socket.IO : ${shared ? 'Redis adapter + etat partage' : 'instance unique'}, /metrics disponible`)
