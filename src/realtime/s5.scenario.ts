import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import jwt from 'jsonwebtoken'
import { io as connectSocket, type Socket } from 'socket.io-client'
import { createStore } from '../store.ts'
import { SECRET } from './security-helpers.ts'
import { startSocketIoServer } from './socketio-server.ts'

interface Member {
  presenceId: string
  userId: string
  label: string
  position: number
  selectionStart: number
  selectionEnd: number
}

interface Snapshot {
  docId: string
  text: string
  version: number
  selfId: string
  members: Member[]
}

const store = createStore()
const httpServer = createServer()
const realtime = startSocketIoServer(httpServer, store)
const clients: Socket[] = []
let passed = 0

function check(label: string, verify: () => void): void {
  verify()
  passed++
  console.log(`OK ${passed} - ${label}`)
}

function nextEvent<T>(
  socket: Socket,
  event: string,
  matches: (value: T) => boolean = () => true,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      reject(new Error(`Evenement absent : ${event}`))
    }, timeoutMs)
    function onEvent(value: T) {
      if (!matches(value)) return
      clearTimeout(timer)
      socket.off(event, onEvent)
      resolve(value)
    }
    socket.on(event, onEvent)
  })
}

function join(socket: Socket, room: string): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    socket.timeout(3_000).emit('join', room, (timeout: Error | null, ok: boolean, reason?: string, snapshot?: Snapshot) => {
      if (timeout || !ok || !snapshot) reject(timeout ?? new Error(reason))
      else resolve(snapshot)
    })
  })
}

function edit(socket: Socket, operation: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.timeout(3_000).emit('op', operation, (timeout: Error | null, ok: boolean, reason?: string) => {
      if (timeout || !ok) reject(timeout ?? new Error(reason))
      else resolve()
    })
  })
}

try {
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}`

  async function connect(userId: string, clientId: string, invalidToken = false): Promise<Socket> {
    const token = invalidToken ? 'invalide' : jwt.sign({ sub: userId }, SECRET, { expiresIn: '1h' })
    const socket = connectSocket(url, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: false,
      auth: { token, clientId },
    })
    clients.push(socket)
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    socket.connect()
    await connected
    return socket
  }

  await assert.rejects(connect('demo-user', 'unauthorized', true), /unauthorized/)
  check('un JWT invalide est refuse', () => {})

  const johnny = await connect('demo-user', 'johnny')
  const johnnySnapshot = await join(johnny, 'doc:doc-notes')
  check('premier snapshot : texte, version et presence personnelle', () => {
    assert.equal(johnnySnapshot.text, 'Ordre du jour :\n- ')
    assert.equal(johnnySnapshot.version, 0)
    assert.equal(johnnySnapshot.members.length, 1)
    assert.equal(johnnySnapshot.selfId, 'demo-user:johnny')
  })

  const alice = await connect('alice', 'alice')
  const aliceJoined = nextEvent<Member>(johnny, 'presence-joined', (m) => m.userId === 'alice')
  await join(alice, 'doc:doc-notes')
  const announcedAlice = await aliceJoined
  check('presence-joined diffuse le profil du nouveau collaborateur', () => {
    assert.equal(announcedAlice.label, 'Alice Bernard')
  })

  const historyBefore = store.documents.get('doc-notes')!.history.length
  const cursorMoved = nextEvent<Member>(johnny, 'cursor:move', (m) => m.userId === 'alice')
  alice.emit('cursor:move', { position: 12, selectionStart: 7, selectionEnd: 12 })
  const cursor = await cursorMoved
  check('curseur et selection ephemeres : aucun ajout dans l’historique', () => {
    assert.equal(cursor.position, 12)
    assert.equal(cursor.selectionStart, 7)
    assert.equal(cursor.selectionEnd, 12)
    assert.equal(store.documents.get('doc-notes')!.history.length, historyBefore)
  })

  const bob = await connect('bob', 'bob')
  const lateSnapshot = await join(bob, 'doc:doc-notes')
  check('arrivee tardive : la selection d’Alice est deja dans le snapshot', () => {
    assert.equal(lateSnapshot.members.length, 3)
    assert.deepEqual(lateSnapshot.members.find((m) => m.userId === 'alice'), cursor)
  })

  await edit(johnny, { kind: 'insert', offset: 0, text: 'TP5 ', docId: 'doc-notes' })
  const shifted = (await join(bob, 'doc:doc-notes')).members.find((m) => m.userId === 'alice')!
  check('une insertion decale les curseurs et selections conserves dans le snapshot', () => {
    assert.equal(shifted.position, 16)
    assert.equal(shifted.selectionStart, 11)
    assert.equal(shifted.selectionEnd, 16)
  })

  await edit(johnny, { kind: 'delete', offset: 0, length: 4, docId: 'doc-notes' })
  const restored = (await join(bob, 'doc:doc-notes')).members.find((m) => m.userId === 'alice')!
  check('une suppression recale correctement le curseur', () => assert.equal(restored.position, 12))

  await assert.rejects(join(bob, 'doc:doc-brief'), /room non autorisee/)
  check('les droits par document sont respectes', () => {})
  const afterRefusal = await join(johnny, 'doc:doc-notes')
  check('un changement de document refuse ne laisse pas de presence fantome', () => {
    assert(!afterRefusal.members.some((m) => m.userId === 'bob'))
  })
  await join(bob, 'doc:doc-notes')

  const boundedCursor = nextEvent<Member>(johnny, 'cursor:move', (m) => m.userId === 'bob')
  bob.emit('cursor:move', { position: 99_999, selectionStart: -12, selectionEnd: 99_999 })
  const bounded = await boundedCursor
  check('les curseurs sont bornes a la longueur du document', () => {
    assert.equal(bounded.position, store.documents.get('doc-notes')!.blocs[0].text.length)
    assert.equal(bounded.selectionStart, 0)
    assert.equal(bounded.selectionEnd, bounded.position)
  })
  bob.emit('cursor:move', { position: 2.5, selectionStart: 0, selectionEnd: 2.5 })
  const afterInvalidCursor = await join(bob, 'doc:doc-notes')
  check('un curseur malforme ne remplace pas la derniere valeur valide', () => {
    assert.equal(afterInvalidCursor.members.find((m) => m.userId === 'bob')!.position, bounded.position)
  })

  const privateAlice = await connect('alice', 'private-alice')
  await join(privateAlice, 'doc:doc-brief')
  let leakedEvents = 0
  for (const event of ['cursor:move', 'presence-joined', 'presence-left', 'op']) {
    privateAlice.on(event, () => leakedEvents++)
  }
  const updated = nextEvent<Member>(johnny, 'cursor:move', (m) => m.userId === 'bob')
  bob.emit('cursor:move', { position: 5, selectionStart: 5, selectionEnd: 5 })
  await updated
  await delay(100)
  check('presence et curseurs restent isoles dans leur room', () => assert.equal(leakedEvents, 0))

  let earlyDepartures = 0
  let repeatedJoins = 0
  let restoredPresences = 0
  johnny.on('presence-left', ({ presenceId }: Member) => {
    if (presenceId === cursor.presenceId) earlyDepartures++
  })
  johnny.on('presence-joined', ({ presenceId }: Member) => {
    if (presenceId === cursor.presenceId) repeatedJoins++
  })
  johnny.on('presence-restored', ({ presenceId }: Member) => {
    if (presenceId === cursor.presenceId) restoredPresences++
  })
  alice.disconnect()
  await delay(300)
  const reconnectedAlice = await connect('alice', 'alice')
  const reconnectedSnapshot = await join(reconnectedAlice, 'doc:doc-notes')
  await delay(5_100)
  check('reconnexion courte : meme identite, selection restauree, aucun faux depart', () => {
    assert.equal(reconnectedSnapshot.selfId, cursor.presenceId)
    const self = reconnectedSnapshot.members.find((m) => m.presenceId === cursor.presenceId)!
    assert.equal(self.position, 12)
    assert.equal(self.selectionStart, 7)
    assert.equal(self.selectionEnd, 12)
    assert.equal(earlyDepartures, 0)
    assert.equal(repeatedJoins, 0)
    assert.equal(restoredPresences, 1)
  })

  const departure = nextEvent<Member>(johnny, 'presence-left', (m) => m.presenceId === cursor.presenceId, 7_000)
  const disconnectedAt = Date.now()
  reconnectedAlice.disconnect()
  await delay(2_000)
  const duringGrace = await join(bob, 'doc:doc-notes')
  assert(duringGrace.members.some((m) => m.presenceId === cursor.presenceId))
  await departure
  const afterGrace = await join(bob, 'doc:doc-notes')
  check('depart apres 5 secondes : presence-left unique et membre retire du snapshot', () => {
    assert(Date.now() - disconnectedAt >= 5_000)
    assert.equal(earlyDepartures, 1)
    assert(!afterGrace.members.some((m) => m.presenceId === cursor.presenceId))
  })

  const returnedAlice = await connect('alice', 'alice')
  const newJoin = nextEvent<Member>(johnny, 'presence-joined', (m) => m.presenceId === cursor.presenceId)
  await join(returnedAlice, 'doc:doc-notes')
  await newJoin
  check('retour apres expiration : nouvelle annonce de presence', () => assert.equal(repeatedJoins, 1))

  const switchedRoom = nextEvent<Member>(johnny, 'presence-left', (m) => m.presenceId === cursor.presenceId)
  await join(returnedAlice, 'doc:doc-brief')
  await switchedRoom
  const afterSwitch = await join(johnny, 'doc:doc-notes')
  check('un changement de room retire immediatement la presence de l’ancien document', () => {
    assert(!afterSwitch.members.some((m) => m.presenceId === cursor.presenceId))
  })

  console.log(`\nTP5 : ${passed} verifications reussies.`)
} finally {
  for (const socket of clients) socket.disconnect()
  await new Promise<void>((resolve) => realtime.close(() => resolve()))
}
