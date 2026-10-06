import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { recordAndApply, type Document } from '../domain.ts'
import { relaySharedEvents, type SseEvent } from '../rest.ts'
import type { ClientOp, Store } from '../store.ts'
import type { CharOp } from './convergence.exemple.ts'
import { DocumentCrdt } from './document-crdt.ts'
import type { CursorState, Member } from './protocol.ts'

interface SharedDocument {
  document: Document
  crdtOps: CharOp[]
  revision: number
}

interface SharedMember extends Member {
  socketId: string
  instance: string
  connected: boolean
  expiresAt: number
}

const COMMIT_DOCUMENT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local changes = cjson.decode(ARGV[3])
redis.call('SET', KEYS[1], ARGV[2])
local events = {}
for _, change in ipairs(changes) do
  local event = {id=redis.call('INCR', KEYS[2]), data=cjson.encode(change)}
  redis.call('RPUSH', KEYS[3], cjson.encode(event))
  table.insert(events, event)
end
redis.call('LTRIM', KEYS[3], -100, -1)
if #events > 0 then redis.call('PUBLISH', ARGV[4], cjson.encode(events)) end
return 1`

const JOIN_MEMBER = `
local previous = redis.call('HGET', KEYS[1], ARGV[1])
local member = cjson.decode(ARGV[2])
local status = 'joined'
if previous then
  local old = cjson.decode(previous)
  if old.expiresAt > tonumber(ARGV[4]) then
    member.position = old.position
    member.selectionStart = old.selectionStart
    member.selectionEnd = old.selectionEnd
    member.anchors = old.anchors
    status = old.connected and 'existing' or 'restored'
  end
end
local encoded = cjson.encode(member)
redis.call('HSET', KEYS[1], ARGV[1], encoded)
redis.call('ZADD', KEYS[2], member.expiresAt, ARGV[3])
return {status, encoded}`

const UPDATE_CURSOR = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return nil end
local member = cjson.decode(raw)
if member.socketId ~= ARGV[2] or not member.connected then return nil end
local cursor = cjson.decode(ARGV[3])
member.position = cursor.position
member.selectionStart = cursor.selectionStart
member.selectionEnd = cursor.selectionEnd
member.anchors = cursor.anchors
local encoded = cjson.encode(member)
redis.call('HSET', KEYS[1], ARGV[1], encoded)
return encoded`

const TOUCH_MEMBER = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local member = cjson.decode(raw)
if member.socketId ~= ARGV[2] or not member.connected then return 0 end
member.expiresAt = tonumber(ARGV[4])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(member))
redis.call('ZADD', KEYS[2], member.expiresAt, ARGV[3])
return 1`

const DISCONNECT_MEMBER = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local member = cjson.decode(raw)
if member.socketId ~= ARGV[2] then return 0 end
member.connected = false
member.expiresAt = tonumber(ARGV[4])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(member))
redis.call('ZADD', KEYS[2], member.expiresAt, ARGV[3])
return 1`

const REMOVE_MEMBER = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then redis.call('ZREM', KEYS[2], ARGV[3]); return nil end
local member = cjson.decode(raw)
if ARGV[2] ~= '' and member.socketId ~= ARGV[2] then return nil end
if ARGV[4] ~= '' and member.expiresAt > tonumber(ARGV[4]) then return nil end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[3])
return raw`

function publicMember(value: SharedMember, text?: DocumentCrdt): Member {
  const { socketId: _socketId, instance: _instance, connected: _connected, expiresAt: _expiry, ...member } = value
  if (text && member.anchors) {
    member.position = text.offsetForAnchor(member.anchors.position)
    member.selectionStart = text.offsetForAnchor(member.anchors.selectionStart)
    member.selectionEnd = text.offsetForAnchor(member.anchors.selectionEnd)
  }
  return member
}

/** L'adapter diffuse les paquets ; cette couche partage aussi l'etat applicatif et les leases. */
export class RedisState {
  private readonly data
  private readonly publisher
  private readonly subscriber
  private readonly localMembers = new Map<string, { docId: string; presenceId: string }>()
  private readonly timers = new Set<ReturnType<typeof setInterval>>()

  constructor(url: string, private readonly namespace: string, readonly instance: string, private readonly store: Store) {
    const settings = { url, socket: { reconnectStrategy: false as const, connectTimeout: 2_000 } }
    this.data = createClient(settings)
    this.publisher = createClient(settings)
    this.subscriber = createClient(settings)
    for (const client of [this.data, this.publisher, this.subscriber]) {
      client.on('error', (error) => console.error(`[${instance}] Redis : ${error.message}`))
    }
  }

  private key(suffix: string): string { return `${this.namespace}:${suffix}` }
  private documentKey(id: string): string { return this.key(`doc:${id}`) }
  private membersKey(id: string): string { return this.key(`members:${id}`) }
  private leaseKey(docId: string, presenceId: string): string { return JSON.stringify([docId, presenceId]) }
  get ready(): boolean { return this.data.isReady && this.publisher.isReady && this.subscriber.isReady }
  private requireReady(): void {
    if (!this.ready) throw Object.assign(new Error('etat partage indisponible'), { statusCode: 503 })
  }

  adapter() {
    return createAdapter(this.publisher, this.subscriber, {
      key: this.key('socket.io'), publishOnSpecificResponseChannel: true,
    })
  }

  async connect(): Promise<void> {
    await Promise.all([this.data.connect(), this.publisher.connect(), this.subscriber.connect()])
    await this.subscriber.subscribe(this.key('sse-events'), (raw) => relaySharedEvents(JSON.parse(raw) as SseEvent[]))
    for (const document of [...this.store.documents.values()]) await this.ensureDocument(document)
    await this.syncStore()
    const history = [...this.store.documents.values()].flatMap((doc) => doc.history.map((op) => ({ docId: doc.id, ...op })))
    await this.data.eval(`
      if not redis.call('SET', KEYS[1], '1', 'NX') then return 0 end
      for _, change in ipairs(cjson.decode(ARGV[1])) do
        local event = {id=redis.call('INCR', KEYS[2]), data=cjson.encode(change)}
        redis.call('RPUSH', KEYS[3], cjson.encode(event))
      end
      redis.call('LTRIM', KEYS[3], -100, -1)
      return 1`, { keys: [this.key('sse-bootstrap'), this.key('sse-id'), this.key('sse-buffer')], arguments: [JSON.stringify(history)] })
    relaySharedEvents(await this.streamBuffer())
  }

  async ensureDocument(document: Document): Promise<void> {
    this.requireReady()
    const text = new DocumentCrdt(`seed:${document.id}`)
    text.insertLocal(0, document.blocs[0]?.text ?? '')
    await this.data.set(this.documentKey(document.id), JSON.stringify({ document, crdtOps: text.snapshot(), revision: 0 }), { NX: true })
    await this.data.sAdd(this.key('documents'), document.id)
  }

  async readDocument(id: string): Promise<SharedDocument | null> {
    this.requireReady()
    const raw = await this.data.get(this.documentKey(id))
    if (!raw) return null
    const state = JSON.parse(raw) as SharedDocument
    this.store.documents.set(id, state.document)
    return state
  }

  async syncStore(): Promise<void> {
    this.requireReady()
    const ids = await this.data.sMembers(this.key('documents'))
    await Promise.all(ids.map((id) => this.readDocument(id)))
  }

  text(state: SharedDocument): DocumentCrdt {
    const text = new DocumentCrdt(`reader:${this.instance}`)
    text.loadSnapshot(state.crdtOps)
    return text
  }

  async apply(docId: string, ops: CharOp[], userId: string): Promise<SharedDocument> {
    this.requireReady()
    for (let attempt = 0; attempt < 40; attempt++) {
      const before = await this.data.get(this.documentKey(docId))
      if (!before) throw new Error('document inconnu')
      const state = JSON.parse(before) as SharedDocument
      const text = this.text(state)
      const changes: ClientOp[] = []
      for (const op of ops) {
        const change = text.apply(op)
        if (!change) continue
        recordAndApply(state.document, { type: change.kind, offset: change.offset, text: change.text,
          length: change.length, by: userId, at: Date.now() })
        changes.push({ ...change, by: userId, docId })
      }
      const crdtOps = text.snapshot()
      if (JSON.stringify(crdtOps) === JSON.stringify(state.crdtOps)) return state
      state.crdtOps = crdtOps
      state.revision++
      const events = changes.map(({ kind, ...change }) => ({ ...change, type: kind }))
      const committed = await this.data.eval(COMMIT_DOCUMENT, {
        keys: [this.documentKey(docId), this.key('sse-id'), this.key('sse-buffer')],
        arguments: [before, JSON.stringify(state), JSON.stringify(events), this.key('sse-events')],
      })
      if (committed === 1) {
        this.store.documents.set(docId, state.document)
        return state
      }
    }
    throw new Error('concurrence trop elevee, recommencez')
  }

  async streamBuffer(): Promise<SseEvent[]> {
    this.requireReady()
    return (await this.data.lRange(this.key('sse-buffer'), 0, -1)).map((event) => JSON.parse(event) as SseEvent)
  }

  async join(member: Member, socketId: string): Promise<{ member: Member; status: string }> {
    this.requireReady()
    const now = Date.now()
    const shared: SharedMember = { ...member, socketId, instance: this.instance, connected: true, expiresAt: now + 15_000 }
    const result = await this.data.eval(JOIN_MEMBER, {
      keys: [this.membersKey(member.docId), this.key('leases')],
      arguments: [member.presenceId, JSON.stringify(shared), this.leaseKey(member.docId, member.presenceId), String(now)],
    }) as [string, string]
    this.localMembers.set(socketId, { docId: member.docId, presenceId: member.presenceId })
    return { status: result[0], member: publicMember(JSON.parse(result[1]) as SharedMember) }
  }

  async members(docId: string, text: DocumentCrdt): Promise<Member[]> {
    return Object.values(await this.data.hGetAll(this.membersKey(docId)))
      .map((raw) => JSON.parse(raw) as SharedMember)
      .filter((member) => member.expiresAt > Date.now())
      .map((member) => publicMember(member, text))
  }

  async cursor(docId: string, presenceId: string, socketId: string, cursor: CursorState): Promise<Member | null> {
    const raw = await this.data.eval(UPDATE_CURSOR, {
      keys: [this.membersKey(docId)], arguments: [presenceId, socketId, JSON.stringify(cursor)],
    }) as string | null
    return raw ? publicMember(JSON.parse(raw) as SharedMember) : null
  }

  async disconnect(socketId: string): Promise<void> {
    const member = this.localMembers.get(socketId)
    this.localMembers.delete(socketId)
    if (!member) return
    await this.data.eval(DISCONNECT_MEMBER, {
      keys: [this.membersKey(member.docId), this.key('leases')],
      arguments: [member.presenceId, socketId, this.leaseKey(member.docId, member.presenceId), String(Date.now() + 5_000)],
    })
  }

  async leave(socketId: string): Promise<Member | null> {
    const member = this.localMembers.get(socketId)
    this.localMembers.delete(socketId)
    if (!member) return null
    const raw = await this.data.eval(REMOVE_MEMBER, {
      keys: [this.membersKey(member.docId), this.key('leases')],
      arguments: [member.presenceId, socketId, this.leaseKey(member.docId, member.presenceId), ''],
    }) as string | null
    return raw ? publicMember(JSON.parse(raw) as SharedMember) : null
  }

  monitor(onLeave: (member: Member) => void): void {
    let checking = false
    this.timers.add(setInterval(() => {
      if (checking || !this.ready) return
      checking = true
      void this.expireMembers().then((members) => members.forEach(onLeave))
        .catch((error) => console.error(`[${this.instance}] presence : ${error.message}`))
        .finally(() => { checking = false })
    }, 250))
    let renewing = false
    this.timers.add(setInterval(() => {
      if (renewing || !this.ready) return
      renewing = true
      void Promise.all([...this.localMembers.entries()].map(([socketId, member]) => this.data.eval(TOUCH_MEMBER, {
        keys: [this.membersKey(member.docId), this.key('leases')],
        arguments: [member.presenceId, socketId, this.leaseKey(member.docId, member.presenceId), String(Date.now() + 15_000)],
      }))).catch((error) => console.error(`[${this.instance}] lease : ${error.message}`))
        .finally(() => { renewing = false })
    }, 3_000))
  }

  private async expireMembers(): Promise<Member[]> {
    const now = Date.now()
    const expired = await this.data.zRangeByScore(this.key('leases'), 0, now, { LIMIT: { offset: 0, count: 100 } })
    const result: Member[] = []
    for (const key of expired) {
      const [docId, presenceId] = JSON.parse(key) as [string, string]
      const raw = await this.data.eval(REMOVE_MEMBER, {
        keys: [this.membersKey(docId), this.key('leases')], arguments: [presenceId, '', key, String(now)],
      }) as string | null
      if (raw) result.push(publicMember(JSON.parse(raw) as SharedMember))
    }
    return result
  }

  async close(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
    await Promise.allSettled([this.data, this.publisher, this.subscriber].map((client) =>
      !client.isOpen ? Promise.resolve() : client.isReady ? client.quit() : client.disconnect()))
  }
}
