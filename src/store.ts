import { buildSeed } from './seed.ts'
import { applyOperation, type Bloc, type Document, type Operation } from './domain.ts'

// Etat en memoire du serveur. Les documents sont "vrais" (exposes par le REST).
// Le stub temps reel, lui, ignore l'identite du document : il edite UN buffer partage
// (c'est le defaut a corriger a l'etape 4 avec des rooms par document).

export interface Store {
  documents: Map<string, Document>
  /** Buffer unique du stub naif : tous les onglets editent le meme texte, quel que soit le doc. */
  naive: { bloc: Bloc }
}

export function createStore(): Store {
  const documents = buildSeed()
  const first = [...documents.values()][0]
  return {
    documents,
    naive: { bloc: { id: 'naive', text: first.blocs[0].text } },
  }
}

export interface ClientOp {
  kind: 'insert' | 'delete'
  offset: number
  text?: string
  length?: number
  by: string
  docId?: string // envoye par le client... et ignore par le stub
}

export function parseClientOp(raw: unknown): ClientOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.kind !== 'insert' && o.kind !== 'delete') return null
  if (typeof o.offset !== 'number') return null
  // Le canal legacy ne doit pas contourner les limites des lots CRDT.
  if (o.kind === 'insert' && (typeof o.text !== 'string' || o.text.length > 512)) return null
  if (o.kind === 'delete' && (typeof o.length !== 'number' ||
      !Number.isSafeInteger(o.length) || o.length < 0 || o.length > 512)) return null
  return {
    kind: o.kind,
    offset: o.offset,
    text: typeof o.text === 'string' ? o.text : undefined,
    length: typeof o.length === 'number' ? o.length : undefined,
    by: typeof o.by === 'string' ? o.by : 'anon',
    docId: typeof o.docId === 'string' ? o.docId : undefined,
  }
}

export function applyNaive(store: Store, op: ClientOp): void {
  const operation: Operation = {
    type: op.kind,
    offset: op.offset,
    text: op.text,
    length: op.length,
    by: op.by,
    at: Date.now(),
  }
  applyOperation(store.naive.bloc, operation) // pas de room, pas d'ordre garanti
}
