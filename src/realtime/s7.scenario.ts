import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { io, type Socket } from 'socket.io-client'
import { DocumentCrdt } from './document-crdt.ts'
import type { CharOp } from './convergence.exemple.ts'
import type { RoomSnapshot, Member } from './protocol.ts'

const A = process.env.URL_A ?? 'http://127.0.0.1:3101'
const B = process.env.URL_B ?? 'http://127.0.0.1:3102'
const PROXY = process.env.URL_PROXY ?? 'http://127.0.0.1:3010'
const clients: Socket[] = []
let passed = 0
const check = (label: string, verify: () => void) => { verify(); console.log(`OK ${++passed} - ${label}`) }

async function json<T = Record<string, unknown>>(base: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`${base}${path} : HTTP ${response.status}`)
  return response.json() as Promise<T>
}
async function token(base: string): Promise<string> {
  return (await json<{ token: string }>(base, '/api/auth/demo', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'demo-user' }) })).token
}
function nextEvent<T>(socket: Socket, event: string, matches: (value: T) => boolean, timeoutMs = 6_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Evenement absent : ${event}`)) }, timeoutMs)
    const listener = (value: T) => { if (matches(value)) { clearTimeout(timer); socket.off(event, listener); resolve(value) } }
    socket.on(event, listener)
  })
}
async function connect(base: string, clientId: string, polling = false): Promise<Socket> {
  const socket = io(base, { autoConnect: false, reconnection: false, transports: [polling ? 'polling' : 'websocket'],
    auth: { token: await token(base), clientId } })
  clients.push(socket)
  const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  socket.connect()
  await connected
  return socket
}
function join(socket: Socket, docId: string): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => socket.timeout(5_000).emit('join', `doc:${docId}`,
    (error: Error | null, ok: boolean, reason: string, snapshot: RoomSnapshot) => error || !ok ? reject(error ?? new Error(reason)) : resolve(snapshot)))
}
function send(socket: Socket, docId: string, ops: CharOp[]): Promise<void> {
  return new Promise((resolve, reject) => socket.timeout(5_000).emit('crdt:op', { docId, ops },
    (error: Error | null, ok: boolean, reason: string) => error || !ok ? reject(error ?? new Error(reason)) : resolve()))
}
const visibleText = async (base: string, docId: string) => (await json<{ text: string }>(base, `/api/docs/${docId}`)).text
async function metrics(base: string): Promise<string> { return (await fetch(base + '/metrics')).text() }
function metric(raw: string, name: string): number {
  const line = raw.split('\n').find((value) => value.startsWith(name + '{'))
  if (!line) throw new Error(`Metrique absente : ${name}`)
  return Number(line.slice(line.lastIndexOf(' ') + 1))
}
async function lastSse(base: string, docId: string, after = 0): Promise<{ id: number; data: { docId: string } }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(base + '/api/stream', { signal: controller.signal, headers: { 'Last-Event-ID': String(after) } })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('Flux SSE ferme sans evenement du document')
      buffered += decoder.decode(chunk.value, { stream: true })
      const packets = buffered.split('\n\n')
      buffered = packets.pop()!
      const matching = packets.flatMap((packet) => {
        const id = packet.match(/^id: (\d+)$/m)
        const data = packet.match(/^data: (.+)$/m)
        if (!id || !data) return []
        const value = { id: Number(id[1]), data: JSON.parse(data[1]) as { docId: string } }
        return value.data.docId === docId ? [value] : []
      })
      if (matching.length) return matching.at(-1)!
    }
  } finally { clearTimeout(timer); controller.abort() }
}

try {
  const [healthA, healthB, healthProxy] = await Promise.all([json(A, '/api/health'), json(B, '/api/health'), json(PROXY, '/api/health')])
  check('deux instances distinctes et Redis connecte', () => {
    assert.equal(healthA.instance, 'A'); assert.equal(healthB.instance, 'B')
    assert.equal(healthA.redis, 'connected'); assert.equal(healthB.redis, 'connected')
    assert(['A', 'B'].includes(String(healthProxy.instance)))
  })
  const created = await json<{ id: string }>(A, '/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `Validation TP7 ${new Date().toISOString()}` }) })
  const docId = created.id
  const emptyOnB = await visibleText(B, docId)
  check('document cree sur A visible sur B', () => { assert(docId.startsWith('doc-')); assert.equal(emptyOnB, '') })
  const identityA = randomUUID()
  const socketA = await connect(A, identityA)
  const socketB = await connect(B, randomUUID())
  const initialA = await join(socketA, docId)
  const modelA = new DocumentCrdt('scenario-A')
  modelA.loadSnapshot(initialA.crdtOps)
  await send(socketA, docId, modelA.insertLocal(0, 'AB'))
  const initialB = await join(socketB, docId)
  const syncedA = await join(socketA, docId)
  const modelB = new DocumentCrdt('scenario-B')
  modelB.loadSnapshot(initialB.crdtOps)
  modelA.loadSnapshot(syncedA.crdtOps)
  check('snapshots A et B : memes positions stables, texte et membres globaux', () => {
    assert.equal(initialB.instance, 'B'); assert.equal(syncedA.instance, 'A')
    assert.deepEqual(initialB.crdtOps, syncedA.crdtOps)
    assert.equal(initialB.text, 'AB'); assert.equal(initialB.members.length, 2)
  })
  const cursorAtB = nextEvent<Member>(socketB, 'cursor:move', (member) => member.presenceId === initialA.selfId)
  socketA.emit('cursor:move', { position: 1, selectionStart: 0, selectionEnd: 1 })
  const cursor = await cursorAtB
  check('curseur et selection A vers B par Redis', () => { assert.equal(cursor.position, 1); assert.equal(cursor.selectionEnd, 1) })

  interface Packet { docId: string; ops: CharOp[] }
  socketA.on('crdt:op', (packet: Packet) => { if (packet.docId === docId) for (const op of packet.ops) modelA.apply(op) })
  socketB.on('crdt:op', (packet: Packet) => { if (packet.docId === docId) for (const op of packet.ops) modelB.apply(op) })
  const x = modelA.insertLocal(1, 'X')
  const y = modelB.insertLocal(1, 'Y')
  const atA = nextEvent<Packet>(socketA, 'crdt:op', (packet) => packet.ops.some((op) => op.value === 'Y'))
  const atB = nextEvent<Packet>(socketB, 'crdt:op', (packet) => packet.ops.some((op) => op.value === 'X'))
  await Promise.all([send(socketA, docId, x), send(socketB, docId, y)])
  await Promise.all([atA, atB])
  check('insertions concurrentes sur A/B : fan-out bidirectionnel et convergence', () => {
    assert.equal(modelA.toString(), modelB.toString())
    assert.equal([...modelA.toString()].sort().join(''), 'ABXY')
  })
  const [textA, textB] = await Promise.all([visibleText(A, docId), visibleText(B, docId)])
  check('etat REST canonique identique sur les deux instances', () => {
    assert.equal(textA, textB); assert.equal(textA, modelA.toString())
  })
  const beforeHistory = await json<unknown[]>(A, `/api/docs/${docId}/history`)
  await send(socketA, docId, x)
  const afterHistory = await json<unknown[]>(B, `/api/docs/${docId}/history`)
  check('renvoi sur une autre instance : pas de doublon dans l’historique', () => assert.equal(beforeHistory.length, afterHistory.length))

  const sseA = await lastSse(A, docId)
  await send(socketB, docId, modelB.insertLocal(modelB.toString().length, 'Z'))
  const sseB = await lastSse(B, docId, sseA.id)
  check('SSE et Last-Event-ID communs a A/B', () => assert(sseB.id > sseA.id))

  const lateSocket = await connect(B, randomUUID())
  const lateSnapshot = await join(lateSocket, docId)
  check('arrivee tardive sur B : editions de A deja dans le snapshot', () => {
    assert.equal(lateSnapshot.text, modelB.toString())
    assert(lateSnapshot.members.some((member) => member.presenceId === initialA.selfId))
  })
  const polling = await connect(PROXY, randomUUID(), true)
  const pollingSnapshot = await join(polling, docId)
  for (let i = 0; i < 5; i++) assert.equal((await join(polling, docId)).instance, pollingSnapshot.instance)
  check('proxy sticky : polling HTTP stable, aucun Session ID unknown', () => assert(['A', 'B'].includes(pollingSnapshot.instance!)))
  polling.disconnect()

  const [metricsA, metricsB] = await Promise.all([metrics(A), metrics(B)])
  check('metriques par instance : connexions actives et Redis', () => {
    assert(metric(metricsA, 'ws_active_connections') >= 1); assert(metric(metricsB, 'ws_active_connections') >= 2)
    assert.equal(metric(metricsA, 'redis_connected'), 1); assert.equal(metric(metricsB, 'redis_connected'), 1)
  })
  let departures = 0
  socketB.on('presence-left', (member: Member) => { if (member.presenceId === initialA.selfId) departures++ })
  socketA.disconnect()
  await delay(200)
  const restored = await connect(B, identityA)
  const restoredSnapshot = await join(restored, docId)
  await delay(5_100)
  check('reconnexion A vers B avant 5 s : meme identite, aucune fausse sortie', () => {
    assert.equal(restoredSnapshot.selfId, initialA.selfId)
    assert.equal(restoredSnapshot.instance, 'B')
    assert.equal(restoredSnapshot.members.filter((member) => member.presenceId === initialA.selfId).length, 1)
    assert.equal(departures, 0)
  })
  const leaving = nextEvent<Member>(socketB, 'presence-left', (member) => member.presenceId === initialA.selfId, 7_000)
  const leftAt = Date.now()
  restored.disconnect()
  await leaving
  check('expiration globale : presence-left unique apres 5 secondes', () => {
    assert(Date.now() - leftAt >= 5_000); assert.equal(departures, 1)
  })
  await assert.rejects(join(socketB, 'doc-brief'), /room non autorisee/)
  check('les autorisations restent appliquees en multi-instance', () => {})
  const beforeInvalid = await visibleText(A, docId)
  await assert.rejects(send(lateSocket, docId, [{ type: 'insert', pos: { path: [1, 0], site: 'invalid-alias' }, value: 'Q' }]), /invalide/)
  await assert.rejects(send(lateSocket, docId, [{ type: 'insert', pos: { path: [500], site: 'invalid-unicode' }, value: '\ud800' }]), /invalide/)
  const afterInvalid = await visibleText(B, docId)
  check('positions non canoniques refusees sans divergence du document', () => assert.equal(afterInvalid, beforeInvalid))
  console.log(`\nTP7 : ${passed} verifications reussies. Document de test : ${docId}`)
} finally {
  for (const socket of clients) socket.disconnect()
}
