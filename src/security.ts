import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { allowedOrigins, SECRET, verifyJwtPayload } from './realtime/security-helpers.ts'
import type { Document } from './domain.ts'
import type { Store } from './store.ts'
import type { RedisState } from './realtime/redis-state.ts'

export function requestIdentity(req: FastifyRequest): { sub: string; exp: number } | null {
  const header = req.headers.authorization
  return verifyJwtPayload(header?.startsWith('Bearer ') ? header.slice(7) : null, SECRET)
}

export function canAccessDocument(doc: Document, userId: string): boolean {
  return doc.ownerId === userId || doc.collaboratorIds.includes(userId)
}

/** Le chargement expose un objet uniquement apres verification de son appartenance. */
export async function readAccessibleDocument(store: Store, shared: RedisState | undefined,
  id: string, userId: string): Promise<Document | undefined> {
  const doc = shared ? (await shared.readDocument(id))?.document : store.documents.get(id)
  return doc && canAccessDocument(doc, userId) ? doc : undefined
}

export async function registerHttpSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    crossOriginEmbedderPolicy: true,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      // Les curseurs utilisent des styles calcules, sans style inline sur les scripts.
      styleSrcAttr: ["'unsafe-inline'"], connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    } },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  })
  const origins = allowedOrigins()
  await app.register(cors, { origin: origins, methods: ['GET', 'POST', 'OPTIONS'] })
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin && !origins.includes(req.headers.origin)) {
      return reply.code(403).send({ error: 'origine non autorisee' })
    }
  })
  app.addHook('onSend', async (req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })
}
