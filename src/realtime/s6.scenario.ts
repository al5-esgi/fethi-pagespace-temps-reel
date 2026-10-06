import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { io as createClient, type Socket } from 'socket.io-client'
import { createDocument } from '../domain.ts'
import { createStore } from '../store.ts'
import type { CharOp } from './convergence.exemple.ts'
import { DocumentCrdt } from './document-crdt.ts'
import { signAccessToken } from './security-helpers.ts'
import { startSocketIoServer } from './socketio-server.ts'

let passed = 0
function check(label: string, action: () => void): void {
  action()
  console.log(`OK ${++passed} - ${label}`)
}

const seed = new DocumentCrdt('seed')
seed.insertLocal(0, 'AB')
const seedSnapshot = seed.snapshot()
function replica(site: string, snapshot = seedSnapshot): DocumentCrdt {
  const text = new DocumentCrdt(site)
  text.loadSnapshot(snapshot)
  return text
}

const a = replica('alice')
const b = replica('bob')
const x = a.insertLocal(1, 'X')
const y = b.insertLocal(1, 'Y')
for (const op of y) a.apply(op)
for (const op of x) b.apply(op)
check('insertions concurrentes au meme endroit : meme texte et aucun caractere perdu', () => {
  assert.equal(a.toString(), b.toString())
  assert.equal([...a.toString()].sort().join(''), 'ABXY')
})
for (const op of [...x, ...y, ...x]) a.apply(op)
check('reception en double : aucune duplication', () => assert.equal(a.toString(), b.toString()))

const deletedX: CharOp = { type: 'delete', pos: x[0].pos }
const orders = [[x[0], y[0], deletedX], [x[0], deletedX, y[0]], [y[0], x[0], deletedX],
  [y[0], deletedX, x[0]], [deletedX, x[0], y[0]], [deletedX, y[0], x[0]]]
const replayed = orders.map((ops, index) => {
  const text = replica(`order:${index}`)
  for (const op of ops) text.apply(op)
  return text.toString()
})
check('six ordres de reception, y compris suppression avant insertion : meme resultat', () => {
  assert.equal(new Set(replayed).size, 1)
  assert.equal([...replayed[0]].sort().join(''), 'ABY')
})
const beforeInsert = replica('delete-first')
beforeInsert.apply(deletedX)
const late = replica('late', beforeInsert.snapshot())
late.apply(x[0])
check('les tombstones du snapshot empechent une resurrection apres reconnexion', () => assert.equal(late.toString(), 'AB'))

const collision = replica('between-sites', [
  { type: 'insert', pos: { path: [500], site: 'alice' }, value: 'A' },
  { type: 'insert', pos: { path: [500], site: 'bob' }, value: 'B' },
])
collision.insertLocal(1, 'X')
collision.insertLocal(2, 'Y')
check('edition ulterieure entre deux insertions dont le chemin numerique coincide', () => assert.equal(collision.toString(), 'AXYB'))

const unicode = new DocumentCrdt('unicode')
unicode.insertLocal(0, 'A🙂B')
unicode.insertLocal(3, '✨')
check('les offsets UTF-16 du textarea preservent les emojis', () => assert.equal(unicode.toString(), 'A🙂✨B'))
unicode.deleteLocal(1, 2)
check('suppression d’un emoji complet et restauration par snapshot', () => {
  assert.equal(unicode.toString(), 'A✨B')
  assert.equal(replica('unicode-late', unicode.snapshot()).toString(), 'A✨B')
})

const store = createStore()
store.documents.set('doc-concurrent', createDocument('doc-concurrent', 'Test concurrence', 'AB', 'alice', ['bob', 'demo-user']))
const httpServer = createServer()
const io = startSocketIoServer(httpServer, store)
const clients: Socket[] = []
interface Snapshot { text: string; crdtOps: CharOp[]; version: number }
interface Packet { docId: string; ops: CharOp[]; by: string }

function nextPacket(socket: Socket, by: string): Promise<Packet> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('crdt:op', listener); reject(new Error('Diffusion CRDT absente')) }, 3_000)
    const listener = (packet: Packet) => {
      if (packet.by !== by) return
      clearTimeout(timer)
      socket.off('crdt:op', listener)
      resolve(packet)
    }
    socket.on('crdt:op', listener)
  })
}

function send(socket: Socket, ops: unknown, docId = 'doc-concurrent'): Promise<void> {
  return new Promise((resolve, reject) => socket.timeout(3_000).emit('crdt:op', { docId, ops, by: 'forged-user' },
    (timeout: Error | null, ok: boolean, reason?: string) => {
      if (timeout || !ok) reject(timeout ?? new Error(reason))
      else resolve()
    }))
}

function join(socket: Socket, docId = 'doc-concurrent'): Promise<Snapshot> {
  return new Promise((resolve, reject) => socket.timeout(3_000).emit('join', `doc:${docId}`,
    (timeout: Error | null, ok: boolean, reason: string | undefined, snapshot: Snapshot) => {
      if (timeout || !ok) reject(timeout ?? new Error(reason))
      else resolve(snapshot)
    }))
}

try {
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  assert(address && typeof address !== 'string')
  async function connect(userId: string, site: string): Promise<{ socket: Socket; text: DocumentCrdt }> {
    const socket = createClient(`http://127.0.0.1:${(address as { port: number }).port}`, {
      autoConnect: false, reconnection: false, transports: ['websocket'],
      auth: { token: signAccessToken(userId), clientId: site },
    })
    clients.push(socket)
    const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
    socket.connect()
    await connected
    const snapshot = await join(socket)
    const text = replica(site, snapshot.crdtOps)
    socket.on('crdt:op', (packet: Packet) => {
      if (packet.docId === 'doc-concurrent') for (const op of packet.ops) text.apply(op)
    })
    return { socket, text }
  }
  const alice = await connect('alice', 'network-alice')
  const bob = await connect('bob', 'network-bob')

  const aliceX = alice.text.insertLocal(1, 'X')
  const bobY = bob.text.insertLocal(1, 'Y')
  const atAlice = nextPacket(alice.socket, 'bob')
  const atBob = nextPacket(bob.socket, 'alice')
  await Promise.all([send(alice.socket, aliceX), send(bob.socket, bobY)])
  await Promise.all([atAlice, atBob])
  check('deux vrais clients Socket.IO, edits concurrentes : clients et serveur convergent', () => {
    assert.equal(alice.text.toString(), bob.text.toString())
    assert.equal(alice.text.toString(), store.documents.get('doc-concurrent')!.blocs[0].text)
    assert.equal([...alice.text.toString()].sort().join(''), 'ABXY')
  })

  const historySize = store.documents.get('doc-concurrent')!.history.length
  await send(alice.socket, aliceX)
  check('un retry reseau ne double ni le texte ni l’historique', () => {
    assert.equal(store.documents.get('doc-concurrent')!.history.length, historySize)
    assert.equal(store.documents.get('doc-concurrent')!.blocs[0].text, alice.text.toString())
  })

  const beforeReordering = alice.text.toString()
  const transientInsert = alice.text.insertLocal(1, 'T')
  const transientDelete = alice.text.deleteLocal(1, 1)
  const deleteAtBob = nextPacket(bob.socket, 'alice')
  await send(alice.socket, transientDelete)
  await deleteAtBob
  const insertAtBob = nextPacket(bob.socket, 'alice')
  await send(alice.socket, transientInsert)
  await insertAtBob
  check('suppression recue avant insertion par le serveur : aucune resurrection', () => {
    assert.equal(store.documents.get('doc-concurrent')!.blocs[0].text, beforeReordering)
    assert.equal(alice.text.toString(), bob.text.toString())
  })

  const indexB = alice.text.toString().indexOf('B')
  const aliceDeleteB = alice.text.deleteLocal(indexB, 1)
  const bobDeleteB = bob.text.deleteLocal(indexB, 1)
  const deleteAtAlice = nextPacket(alice.socket, 'bob')
  const deleteAgainAtBob = nextPacket(bob.socket, 'alice')
  await Promise.all([send(alice.socket, aliceDeleteB), send(bob.socket, bobDeleteB)])
  await Promise.all([deleteAtAlice, deleteAgainAtBob])
  check('suppression concurrente du meme caractere : une seule suppression visible', () => {
    assert.equal(alice.text.toString(), bob.text.toString())
    assert.equal(alice.text.toString(), store.documents.get('doc-concurrent')!.blocs[0].text)
    assert(!alice.text.toString().includes('B'))
  })

  const candidate = replica('invalid-batch', alice.text.snapshot()).insertLocal(0, 'Z')
  const beforeInvalid = store.documents.get('doc-concurrent')!.blocs[0].text
  await assert.rejects(send(bob.socket, [...candidate, { type: 'insert', pos: { path: [-1], site: 'bad' }, value: '!' }]), /invalide/)
  check('lot malforme : validation atomique, aucun changement partiel', () => {
    assert.equal(store.documents.get('doc-concurrent')!.blocs[0].text, beforeInvalid)
  })
  await assert.rejects(send(bob.socket, candidate, 'doc-brief'), /document non rejoint/)
  check('autorisation par document toujours appliquee au canal CRDT', () => {})
  check('l’auteur de l’historique vient du JWT et non du paquet client', () => {
    assert(store.documents.get('doc-concurrent')!.history.every((op) => ['alice', 'bob'].includes(op.by)))
  })

  const johnny = await connect('demo-user', 'network-late')
  check('snapshot tardif : texte, positions et tombstones deja synchronises', () => {
    assert.equal(johnny.text.toString(), alice.text.toString())
    assert(johnny.text.snapshot().some((op) => op.type === 'delete'))
  })
  await join(alice.socket)
  await join(bob.socket)
  const snapshot = await join(johnny.socket)
  check('snapshot serveur et texte REST partagent le meme etat', () => {
    assert.equal(replica('snapshot-check', snapshot.crdtOps).toString(), snapshot.text)
    assert.equal(snapshot.version, store.documents.get('doc-concurrent')!.history.length)
  })
  console.log(`\nTP6 : ${passed} verifications reussies.`)
} finally {
  for (const socket of clients) socket.disconnect()
  await new Promise<void>((resolve) => io.close(() => resolve()))
}
