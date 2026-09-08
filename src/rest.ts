import type { ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { createDocument, renderText, type Document } from './domain.ts'
import type { ClientOp, Store } from './store.ts'

interface SseEvent {
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

export function registerRoutes(app: FastifyInstance, store: Store): void {
  // Le document de demonstration contient deja un historique : il initialise le flux SSE.
  for (const doc of store.documents.values()) {
    for (const operation of doc.history) {
      record({ docId: doc.id, ...operation })
    }
  }

  app.get('/api/stream', (req, reply) => {
    reply.hijack()
    const res = reply.raw

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const parsedId = Number(req.headers['last-event-id'] ?? 0)
    const lastEventId = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 0
    const oldestBufferedId = events[0]?.id ?? Infinity

    if (lastEventId > 0 && lastEventId < oldestBufferedId - 1) {
      res.write('event: resync-needed\ndata: buffer depasse, rechargez le document\n\n')
    }

    for (const event of events) {
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

  app.get('/api/docs', async () =>
    [...store.documents.values()].map((d) => ({ id: d.id, title: d.title })),
  )

  app.get('/api/docs/:id', async (req, reply) => {
    const doc = store.documents.get((req.params as { id: string }).id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return { id: doc.id, title: doc.title, text: renderText(doc) }
  })

  app.get('/api/docs/:id/history', async (req, reply) => {
    const doc = store.documents.get((req.params as { id: string }).id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return doc.history
  })

  app.get('/api/docs/:id/snapshot', async (req, reply) => {
    const doc = store.documents.get((req.params as { id: string }).id)
    if (!doc) return reply.code(404).send({ error: 'document inconnu' })
    return { id: doc.id, blocs: doc.blocs, version: doc.history.length }
  })

  app.post('/api/docs', async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string }
    if (!body.title) return reply.code(400).send({ error: 'title requis' })
    const doc: Document = createDocument(`doc-${Date.now().toString(36)}`, body.title)
    store.documents.set(doc.id, doc)
    return reply.code(201).send({ id: doc.id, title: doc.title })
  })
}
