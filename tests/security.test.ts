import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { io as clientIo, type Socket } from 'socket.io-client'
import { createStore } from '../src/store.ts'
import { publishOperation, registerRoutes } from '../src/rest.ts'
import { registerHttpSecurity } from '../src/security.ts'
import { startSocketIoServer } from '../src/realtime/socketio-server.ts'
import { SECRET, signAccessToken, verifyJwtPayload } from '../src/realtime/security-helpers.ts'

const app = Fastify({ bodyLimit: 65_536 })
const store = createStore()
let base: string
let server: ReturnType<typeof startSocketIoServer>
const sockets: Socket[] = []
const auth = (user = 'demo-user') => ({ authorization: `Bearer ${signAccessToken(user)}` })
before(async () => {
  await registerHttpSecurity(app)
  registerRoutes(app, store)
  app.get('/api/health', async () => ({ status: 'ok' }))
  server = startSocketIoServer(app.server, store)
  base = await app.listen({ host: '127.0.0.1', port: 0 })
})
after(async () => {
  for (const socket of sockets) socket.disconnect()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await app.close()
})
function connect(token = signAccessToken('demo-user'), origin = 'http://localhost:3000'): Promise<Socket> {
  const socket = clientIo(base, { transports: ['websocket'], reconnection: false, autoConnect: false,
    timeout: 2000, extraHeaders: { Origin: origin }, auth: { token } })
  sockets.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); socket.connect()
  })
}
function emit(socket: Socket, event: string, data: unknown): Promise<[boolean, string?]> {
  return new Promise((resolve, reject) => socket.timeout(2000).emit(event, data,
    (error: Error | null, ...result: [boolean, string?]) => error ? reject(error) : resolve(result)))
}

test('REST: aucune lecture anonyme, aucun document prive dans la liste', async () => {
  for (const path of ['/api/docs', '/api/docs/doc-brief', '/api/docs/doc-brief/history', '/api/docs/doc-brief/snapshot']) {
    assert.equal((await app.inject(path)).statusCode, 401)
  }
  for (const suffix of ['', '/history', '/snapshot']) {
    assert.equal((await app.inject({ url: '/api/docs/doc-brief' + suffix, headers: auth() })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/docs/doc-brief' + suffix, headers: auth('alice') })).statusCode, 200)
  }
  const list = (await app.inject({ url: '/api/docs', headers: auth() })).json()
  assert(list.some((doc: { id: string }) => doc.id === 'doc-notes'))
  assert(!list.some((doc: { id: string }) => doc.id === 'doc-brief'))
})

test('creation: proprietaire tire du JWT et corps borne', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/docs', payload: { title: 'inconnu' } })).statusCode, 401)
  const response = await app.inject({ method: 'POST', url: '/api/docs', headers: auth(), payload: { title: 'Isolation', ownerId: 'alice' } })
  assert.equal(response.statusCode, 201)
  const id = response.json().id
  assert.equal(store.documents.get(id)?.ownerId, 'demo-user')
  assert.equal((await app.inject({ url: `/api/docs/${id}`, headers: auth('alice') })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/docs', headers: auth(), payload: { title: 'x'.repeat(201) } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: '/api/docs', headers: auth(), payload: { title: 'x'.repeat(70000) } })).statusCode, 413)
})

test('SSE: authentification, docId et filtre des evenements par document', async () => {
  assert.equal((await app.inject('/api/stream?docId=doc-notes')).statusCode, 401)
  assert.equal((await app.inject({ url: '/api/stream?docId=doc-brief', headers: auth() })).statusCode, 403)
  assert.equal((await app.inject({ url: '/api/stream', headers: auth() })).statusCode, 403)
  publishOperation({ docId: 'doc-notes', kind: 'insert', offset: 0, text: 'public', by: 'alice' })
  publishOperation({ docId: 'doc-brief', kind: 'insert', offset: 0, text: 'confidentiel', by: 'alice' })
  const controller = new AbortController()
  try {
    const response = await fetch(base + '/api/stream?docId=doc-notes', { headers: auth(), signal: controller.signal })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const reader = response.body!.getReader()
    const chunk = await reader.read()
    const data = new TextDecoder().decode(chunk.value)
    assert(data.includes('doc-notes')); assert(!data.includes('doc-brief'))
    assert(!data.includes('confidentiel'))
    publishOperation({ docId: 'doc-brief', kind: 'insert', offset: 0, text: 'secret-live', by: 'alice' })
    publishOperation({ docId: 'doc-notes', kind: 'insert', offset: 0, text: 'authorized-live', by: 'alice' })
    const live = new TextDecoder().decode((await reader.read()).value)
    assert(live.includes('authorized-live'))
    assert(!live.includes('secret-live'))
  } finally { controller.abort() }
})

test('JWT: refuse ancienne cle, absence expiration, audience incorrecte et HS512', () => {
  const options = { issuer: 'pagespace', audience: 'pagespace-api', expiresIn: '1h' as const }
  for (const token of [
    jwt.sign({ sub: 'alice' }, ['change', 'moi'].join('-'), options),
    jwt.sign({ sub: 'alice' }, SECRET, { issuer: 'pagespace', audience: 'pagespace-api' }),
    jwt.sign({ sub: 'alice' }, SECRET, { ...options, audience: 'ailleurs' }),
    jwt.sign({ sub: 'alice' }, SECRET, { ...options, algorithm: 'HS512' }),
  ]) assert.equal(verifyJwtPayload(token, SECRET), null)
  assert.equal(verifyJwtPayload(signAccessToken('alice'), SECRET)?.sub, 'alice')
})

test('Socket.IO: JWT et Origin controles sur le handshake WebSocket', async () => {
  await assert.rejects(connect('invalide'))
  await assert.rejects(connect(signAccessToken('alice'), 'https://evil.example'))
  const socket = await connect()
  assert.equal((await emit(socket, 'join', 'doc:doc-brief'))[0], false)
  assert.equal((await emit(socket, 'join', 'doc:doc-notes'))[0], true)
  const historyLength = store.documents.get('doc-notes')!.history.length
  assert.equal((await emit(socket, 'crdt:op', { docId: 'doc-notes', ops: Array(513).fill({ type: 'delete', pos: { path: [1], site: 'attack' } }) }))[0], false)
  assert.equal((await emit(socket, 'op', { docId: 'doc-notes', kind: 'insert', offset: 0, text: 'x'.repeat(513) }))[0], false)
  assert.equal((await emit(socket, 'op', { docId: 'doc-notes', kind: 'delete', offset: 0, length: 513 }))[0], false)
  assert.equal(store.documents.get('doc-notes')!.history.length, historyLength)
  socket.disconnect()
})

test('Socket.IO: expiration du JWT ferme une connexion deja ouverte', async () => {
  const token = jwt.sign({ sub: 'demo-user' }, SECRET, { issuer: 'pagespace', audience: 'pagespace-api', expiresIn: '2s' })
  const socket = await connect(token)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connexion conservee apres expiration')), 3500)
    socket.once('disconnect', () => { clearTimeout(timer); resolve() })
  })
})

test('HTTP: CSP sans script inline, API non cacheable et CORS restreint', async () => {
  const response = await app.inject({ url: '/api/docs', headers: auth() })
  assert(response.headers['content-security-policy']?.includes("script-src 'self'"))
  assert(!response.headers['content-security-policy']?.includes("script-src 'self' 'unsafe-inline'"))
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['referrer-policy'], 'no-referrer')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal((await app.inject({ url: '/api/docs', headers: { ...auth(), origin: 'https://evil.example' } })).statusCode, 403)
})

test('production: refuse cle absente/courte et desactive la connexion demo', () => {
  const source = "import('./src/realtime/security-helpers.ts').then(m=>console.log(m.DEMO_AUTH_ENABLED))"
  const env = { ...process.env, NODE_ENV: 'production', AUTH_MODE: 'demo' }
  for (const secret of ['', 'court']) {
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', '-e', source],
      { env: { ...env, JWT_SECRET: secret }, stdio: 'pipe' }))
  }
  assert.equal(execFileSync(process.execPath, ['--import', 'tsx', '-e', source],
    { env: { ...env, JWT_SECRET: SECRET }, encoding: 'utf8' }).trim(), 'false')
})
