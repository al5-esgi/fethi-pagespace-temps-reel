import type { FastifyInstance } from 'fastify'
import { createDocument, renderText, type Document } from './domain.ts'
import type { Store } from './store.ts'

export function registerRoutes(app: FastifyInstance, store: Store): void {
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
