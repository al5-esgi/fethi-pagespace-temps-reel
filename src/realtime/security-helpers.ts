import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'

// Helpers fournis : dans votre template, vous les branchez, vous ne les reecrivez pas.

export function verifyJwt(token: string | null, secret: string): boolean {
  return verifyJwtPayload(token, secret) !== null
}

/** Variante qui retourne le payload : utile quand on a besoin de l'identite, pas d'un booleen. */
export function verifyJwtPayload(
  token: string | null,
  secret: string,
): { sub: string; exp: number } | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'pagespace', audience: 'pagespace-api' })
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub ||
        typeof payload.exp !== 'number') return null
    return { sub: payload.sub, exp: payload.exp }
  } catch {
    return null
  }
}

/** Compteur remis a zero chaque seconde : au-dela de maxPerSecond, hit() renvoie false. */
export class RateLimiter {
  private count = 0
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly maxPerSecond: number) {
    this.timer = setInterval(() => {
      this.count = 0
    }, 1000)
  }

  hit(): boolean {
    this.count++
    return this.count <= this.maxPerSecond
  }

  stop(): void {
    clearInterval(this.timer)
  }
}

function signingSecret(): string {
  const configured = process.env.JWT_SECRET
  if (configured && Buffer.byteLength(configured) >= 32) return configured
  if (configured || process.env.NODE_ENV === 'production' || process.env.REDIS_URL) {
    throw new Error('JWT_SECRET doit contenir au moins 32 octets et etre partage entre les instances')
  }
  // Une seule instance locale : la cle ne survit pas au redemarrage.
  return randomBytes(48).toString('base64url')
}

export const SECRET = signingSecret()
export const DEMO_AUTH_ENABLED = process.env.NODE_ENV !== 'production' && process.env.AUTH_MODE !== 'disabled'

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, SECRET, {
    algorithm: 'HS256', expiresIn: '1h', issuer: 'pagespace', audience: 'pagespace-api',
  })
}

export function allowedOrigins(port = Number(process.env.PORT ?? 3000)): string[] {
  return process.env.PUBLIC_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean)
    ?? [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
}
