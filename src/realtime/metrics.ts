import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import type { Server } from 'socket.io'

export class RealtimeMetrics {
  readonly registry = new Registry()
  private readonly active: Gauge
  private readonly connects: Counter
  private readonly disconnects: Counter
  private readonly rooms: Gauge
  private readonly redisReady: Gauge
  private readonly messages: Counter
  private readonly handshake: Histogram

  constructor(instance: string) {
    this.registry.setDefaultLabels({ instance })
    const registers = [this.registry]
    this.active = new Gauge({ name: 'ws_active_connections', help: 'Connexions Socket.IO actuellement ouvertes', registers })
    this.connects = new Counter({ name: 'ws_connects_total', help: 'Connexions Socket.IO etablies', registers })
    this.disconnects = new Counter({ name: 'ws_disconnects_total', help: 'Connexions Socket.IO fermees', registers })
    this.rooms = new Gauge({ name: 'ws_document_rooms', help: 'Rooms document avec une connexion locale', registers })
    this.redisReady = new Gauge({ name: 'redis_connected', help: 'Redis disponible (1) ou absent (0)', registers })
    this.messages = new Counter({ name: 'ws_crdt_batches_total', help: 'Lots CRDT acceptes', registers })
    this.handshake = new Histogram({ name: 'ws_handshake_seconds', help: 'Duree serveur entre handshake et connexion',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2], registers })
  }

  observe(io: Server): void {
    io.on('connection', (socket) => {
      this.active.inc()
      this.connects.inc()
      this.handshake.observe(Math.max(0, Date.now() - socket.handshake.issued) / 1_000)
      socket.once('disconnect', () => { this.active.dec(); this.disconnects.inc() })
    })
  }

  acceptedBatch(): void { this.messages.inc() }

  async render(io: Server, redisReady: boolean): Promise<string> {
    this.rooms.set([...io.of('/').adapter.rooms.keys()].filter((room) => room.startsWith('doc:')).length)
    this.redisReady.set(redisReady ? 1 : 0)
    return this.registry.metrics()
  }
}
