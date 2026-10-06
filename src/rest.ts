import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { createDocument, renderText, type Document } from './domain.ts'
import { DEMO_PROFILES, findDemoProfile } from './profiles.ts'
import { SECRET } from './realtime/security-helpers.ts'
import type { ClientOp, Store } from './store.ts'
import type { RedisState } from './realtime/redis-state.ts'

export interface SseEvent {
  id: number
  data: string
}

const MAX_BUFFER = 100
const events: SseEvent[] = []
const clients = new Set<ServerResponse>()
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

  for (const client of clients) {
    if (!client.writableEnded) send(client, event)
  }
}

export function relaySharedEvents(batch: SseEvent[]): void {
  for (const event of batch) {
    if (events.some((known) => known.id === event.id)) continue
    events.push(event)
    events.sort((a, b) => a.id - b.id)
    while (events.length > MAX_BUFFER) events.shift()
    nextId = Math.max(nextId, event.id + 1)
    for (const client of clients) if (!client.writableEnded) send(client, event)
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
    const sharedBuffer = shared ? await shared.streamBuffer() : null
    reply.hijack()
    const res = reply.raw

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
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
      if (event.id > lastEventId) send(res, event)
    }

    clients.add(res)
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n')
    }, 15_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(res)
    })
  })

  app.get('/api/docs', async () => {
    if (shared) await shared.syncStore()
    return [...store.documents.values()].map((d) => ({
      id: d.id,
      title: d.title,
      ownerId: d.ownerId,
      collaboratorIds: d.collaboratorIds,
    }))
  })

  app.get('/api/profiles', async () => DEMO_PROFILES)

  app.post('/api/auth/demo', async (req, reply) => {
    const body = (req.body ?? {}) as { profileId?: string }
    const profile = body.profileId ? findDemoProfile(body.profileId) : undefined
    if (!profile) return reply.code(400).send({ error: 'profil inconnu' })

    const token = jwt.sign({ sub: profile.id }, SECRET, { expiresIn: '4h' })
    return { token, profile }
  })

  app.get('/api/docs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const doc = shared ? (await shared.readDocument(id))?.document : store.documents.get(id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return { id: doc.id, title: doc.title, text: renderText(doc) }
  })

  app.get('/api/docs/:id/history', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const doc = shared ? (await shared.readDocument(id))?.document : store.documents.get(id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return doc.history
  })

  app.get('/api/docs/:id/snapshot', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const doc = shared ? (await shared.readDocument(id))?.document : store.documents.get(id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return { id: doc.id, blocs: doc.blocs, version: doc.history.length }
  })

  app.post('/api/docs', async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string }
    if (!body.title) return reply.code(400).send({ error: 'title requis' })
    const doc: Document = createDocument(`doc-${randomUUID()}`, body.title)
    store.documents.set(doc.id, doc)
    if (shared) await shared.ensureDocument(doc)
    return reply.code(201).send({ id: doc.id, title: doc.title })
  })
}
