import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { publishOperation, registerRoutes } from './rest.ts'
import { createStore, parseClientOp, applyNaive, type ClientOp } from './store.ts'
import { startNaiveStub } from './realtime/naive-stub.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)

const store = createStore()
const app = Fastify({ logger: false })

await app.register(fastifyStatic, { root: join(HERE, '..', 'public') })
registerRoutes(app, store)

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`editeur-collaboratif : http://localhost:${PORT}`)

// --- couche temps reel : POUR L'INSTANT le stub naif. C'est ce que vous remplacez (voir TRANSPOSITION.md). ---
startNaiveStub<ClientOp>(app.server, {
  fullState: () => ({ text: store.naive.bloc.text }), // pas de curseurs (defaut : etape 5)
  parseInput: parseClientOp,
  applyInput: (op) => {
    applyNaive(store, op)
    publishOperation(op)
  },
})
console.log('couche temps reel : stub naif (voir src/realtime/naive-stub.ts)')
