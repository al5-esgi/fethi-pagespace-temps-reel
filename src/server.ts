import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerRoutes } from './rest.ts'
import { createStore } from './store.ts'
import { startSocketIoServer } from './realtime/socketio-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)

const store = createStore()
const app = Fastify({ logger: false })

await app.register(fastifyStatic, { root: join(HERE, '..', 'public') })
registerRoutes(app, store)
startSocketIoServer(app.server, store)

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`editeur-collaboratif : http://localhost:${PORT}`)
console.log('couche temps reel : Socket.IO avec rooms doc:<id>')
