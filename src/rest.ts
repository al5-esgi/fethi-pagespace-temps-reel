import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createDocument, renderText, type Document } from './domain.ts'
import { DEMO_PROFILES, findDemoProfile } from './profiles.ts'
import { DEMO_AUTH_ENABLED, signAccessToken } from './realtime/security-helpers.ts'
import { canAccessDocument, readAccessibleDocument, requestIdentity } from './security.ts'
import type { ClientOp, Store } from './store.ts'
import type { RedisState } from './realtime/redis-state.ts'

export interface SseEvent {
  id: number
  data: string
}

const MAX_BUFFER = 100
const events: SseEvent[] = []
const clients = new Map<ServerResponse, string>()
let nextId = 1

function record(data: unknown): SseEvent {
  const event = { id: nextId++, data: JSON.stringify(data) }
  events.push(event)
  if (events.length > MAX_BUFFER) events.shift()
  return event
}

function send(res: ServerResponse, event: SseEvent): void {
  res.write(`id: ${event.id}\n`)
  res.write(`data: ${event.data}\n\n`)
}

export function publishOperation(op: ClientOp): void {
  const event = record({
    docId: op.docId,
    type: op.kind,
    offset: op.offset,
    text: op.text,
    length: op.length,
    by: op.by,
  })

  for (const [client, docId] of clients) {
    if (!client.writableEnded && docId === op.docId) send(client, event)
  }
}

export function relaySharedEvents(batch: SseEvent[]): void {
  for (const event of batch) {
    if (events.some((known) => known.id === event.id)) continue
    events.push(event)
    events.sort((a, b) => a.id - b.id)
    while (events.length > MAX_BUFFER) events.shift()
    nextId = Math.max(nextId, event.id + 1)
    const docId = (JSON.parse(event.data) as { docId: string }).docId
    for (const [client, subscribedId] of clients) {
      if (!client.writableEnded && subscribedId === docId) send(client, event)
    }
  }
}

export function registerRoutes(app: FastifyInstance, store: Store, shared?: RedisState): void {
  // Le document de demonstration contient deja un historique : il initialise le flux SSE.
  for (const doc of shared ? [] : store.documents.values()) {
    for (const operation of doc.history) {
      record({ docId: doc.id, ...operation })
    }
  }

  app.get('/api/stream', async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    const docId = (req.query as { docId?: string }).docId
    if (!docId || !await readAccessibleDocument(store, shared, docId, identity.sub)) {
      return reply.code(403).send({ error: 'document non autorise' })
    }
    const sharedBuffer = shared ? await shared.streamBuffer() : null
    reply.hijack()
    const res = reply.raw
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) res.setHeader(name, value)
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })

    const parsedId = Number(req.headers['last-event-id'] ?? 0)
    const lastEventId = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 0
    const buffered = sharedBuffer
      ? [...new Map([...sharedBuffer, ...events.filter((event) => event.id >= (sharedBuffer[0]?.id ?? Infinity))]
        .map((event) => [event.id, event])).values()].sort((a, b) => a.id - b.id).slice(-MAX_BUFFER)
      : events
    const oldestBufferedId = buffered[0]?.id ?? Infinity

    if (lastEventId > 0 && lastEventId < oldestBufferedId - 1) {
      res.write('event: resync-needed\ndata: buffer depasse, rechargez le document\n\n')
    }

    for (const event of buffered) {
      if (event.id > lastEventId && (JSON.parse(event.data) as { docId: string }).docId === docId) send(res, event)
    }

    clients.set(res, docId)
    const expiry = setTimeout(() => res.end(), Math.max(0, identity.exp * 1000 - Date.now()))
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n')
    }, 15_000)

    res.on('close', () => {
      clearInterval(heartbeat)
      clearTimeout(expiry)
      clients.delete(res)
    })
  })

  app.get('/api/docs', async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    if (shared) await shared.syncStore()
    return [...store.documents.values()].filter((d) => canAccessDocument(d, identity.sub)).map((d) => ({
      id: d.id,
      title: d.title,
      ownerId: d.ownerId,
      collaboratorIds: d.collaboratorIds,
    }))
  })

  app.get('/api/profiles', async (_req, reply) => DEMO_AUTH_ENABLED
    ? DEMO_PROFILES : reply.code(404).send({ error: 'mode demo desactive' }))

  app.post('/api/auth/demo', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: {
    body: { type: 'object', required: ['profileId'], additionalProperties: false,
      properties: { profileId: { type: 'string', maxLength: 100 } } },
  } }, async (req, reply) => {
    if (!DEMO_AUTH_ENABLED) return reply.code(404).send({ error: 'mode demo desactive' })
    const body = (req.body ?? {}) as { profileId?: string }
    const profile = body.profileId ? findDemoProfile(body.profileId) : undefined
    if (!profile) return reply.code(400).send({ error: 'profil inconnu' })

    const token = signAccessToken(profile.id)
    return { token, profile }
  })

  app.get('/api/docs/:id', async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    const id = (req.params as { id: string }).id
    const doc = await readAccessibleDocument(store, shared, id, identity.sub)
    if (!doc) return reply.code(403).send({ error: 'document non autorise' })
    return { id: doc.id, title: doc.title, text: renderText(doc) }
  })

  app.get('/api/docs/:id/history', async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    const id = (req.params as { id: string }).id
    const doc = await readAccessibleDocument(store, shared, id, identity.sub)
    if (!doc) return reply.code(403).send({ error: 'document non autorise' })
    return doc.history
  })

  app.get('/api/docs/:id/snapshot', async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    const id = (req.params as { id: string }).id
    const doc = await readAccessibleDocument(store, shared, id, identity.sub)
    if (!doc) return reply.code(403).send({ error: 'document non autorise' })
    return { id: doc.id, blocs: doc.blocs, version: doc.history.length }
  })

  app.post('/api/docs', { schema: {
    body: { type: 'object', required: ['title'], additionalProperties: false,
      properties: { title: { type: 'string', minLength: 1, maxLength: 200 } } },
  } }, async (req, reply) => {
    const identity = requestIdentity(req)
    if (!identity) return reply.code(401).send({ error: 'authentification requise' })
    const body = (req.body ?? {}) as { title?: string }
    if (!body.title) return reply.code(400).send({ error: 'title requis' })
    const doc: Document = createDocument(`doc-${randomUUID()}`, body.title, '', identity.sub)
    store.documents.set(doc.id, doc)
    if (shared) await shared.ensureDocument(doc)
    return reply.code(201).send({ id: doc.id, title: doc.title })
  })
}
