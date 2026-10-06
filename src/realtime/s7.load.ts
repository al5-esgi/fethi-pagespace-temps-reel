import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { io, type Socket } from 'socket.io-client'

const N = Number(process.env.N ?? 100)
if (!Number.isSafeInteger(N) || N < 2 || N > 1_000) throw new Error('N doit etre compris entre 2 et 1000')
const urls = [process.env.URL_A ?? 'http://127.0.0.1:3101', process.env.URL_B ?? 'http://127.0.0.1:3102']
const sockets: Socket[] = []
const elapsed: number[] = []
const metrics = async () => Promise.all(urls.map(async (url) => (await fetch(url + '/metrics')).text()))
const gauge = (raw: string, name: string) => Number(raw.split('\n').find((line) => line.startsWith(name + '{'))?.split(' ').at(-1))
const before = await metrics()
const auth = await fetch(urls[0] + '/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ profileId: 'demo-user' }) }).then((res) => res.json()) as { token: string }
const created = await fetch(urls[0] + '/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
  body: JSON.stringify({ title: `Charge TP7 ${new Date().toISOString()}` }) }).then((res) => res.json()) as { id: string }
let during: string[] = []
let after: string[] = []
const started = performance.now()
try {
  await Promise.all(Array.from({ length: N }, async (_value, index) => {
    const start = performance.now()
    const socket = io(urls[index % 2], { autoConnect: false, transports: ['websocket'], reconnection: false,
      auth: { token: auth.token, clientId: randomUUID() } })
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connexion expiree')), 10_000)
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error) })
      socket.once('connect', () => {
        elapsed.push(performance.now() - start)
        socket.timeout(8_000).emit('join', `doc:${created.id}`, (error: Error | null, ok: boolean, reason: string) => {
          clearTimeout(timer)
          if (error || !ok) reject(error ?? new Error(reason)); else resolve()
        })
      })
      socket.connect()
    })
  }))
  during = await metrics()
  for (let i = 0; i < 2; i++) assert.equal(gauge(during[i], 'ws_active_connections') - gauge(before[i], 'ws_active_connections'),
    Math.floor(N / 2) + (i === 0 ? N % 2 : 0))
} finally {
  for (const socket of sockets) socket.disconnect()
  for (let attempt = 0; attempt < 30; attempt++) {
    after = await metrics()
    if (after.every((value, index) => gauge(value, 'ws_active_connections') === gauge(before[index], 'ws_active_connections'))) break
    await delay(100)
  }
}
for (let i = 0; i < 2; i++) assert.equal(gauge(after[i], 'ws_active_connections'), gauge(before[i], 'ws_active_connections'))
elapsed.sort((a, b) => a - b)
const quantile = (p: number) => Math.round(elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * p))] * 100) / 100
const result = { date: new Date().toISOString(), connections: N, successful: elapsed.length,
  totalMs: Math.round((performance.now() - started) * 100) / 100, handshakeP50Ms: quantile(0.5), handshakeP95Ms: quantile(0.95),
  instances: urls.map((url, index) => ({ instance: index === 0 ? 'A' : 'B', url,
    before: gauge(before[index], 'ws_active_connections'), during: gauge(during[index], 'ws_active_connections'),
    after: gauge(after[index], 'ws_active_connections'), roomsDuring: gauge(during[index], 'ws_document_rooms'),
    redisConnected: gauge(during[index], 'redis_connected') })) }
const output = new URL('../../docs/captures/s7/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(new URL('load-results.json', output), JSON.stringify(result, null, 2) + '\n')
for (const [name, snapshots] of [['before', before], ['during', during], ['after', after]] as const) {
  for (let i = 0; i < 2; i++) await writeFile(new URL(`metrics-${i === 0 ? 'A' : 'B'}-${name}.prom`, output), snapshots[i])
}
console.log(JSON.stringify(result, null, 2))
