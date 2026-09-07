// Domaine : edition collaborative d'un document en blocs de texte.
// Pur, sans I/O. Teste par src/realtime/piege.scenario.ts.

export interface Operation {
  type: 'insert' | 'delete'
  offset: number
  text?: string // pour insert
  length?: number // pour delete
  by: string // id de l'auteur
  at: number // timestamp
}

export interface Bloc {
  id: string
  text: string
}

export interface Document {
  id: string
  title: string
  blocs: Bloc[]
  history: Operation[]
}

/** Applique une operation a un bloc (mutation en place). "Dernier ecrivain gagne" sur l'offset. */
export function applyOperation(bloc: Bloc, op: Operation): void {
  const clamp = (n: number) => Math.max(0, Math.min(n, bloc.text.length))
  if (op.type === 'insert') {
    const at = clamp(op.offset)
    bloc.text = bloc.text.slice(0, at) + (op.text ?? '') + bloc.text.slice(at)
  } else {
    const at = clamp(op.offset)
    const end = clamp(op.offset + (op.length ?? 0))
    bloc.text = bloc.text.slice(0, at) + bloc.text.slice(end)
  }
}

export function createDocument(id: string, title: string, initial = ''): Document {
  return { id, title, blocs: [{ id: `${id}-b1`, text: initial }], history: [] }
}

export function recordAndApply(doc: Document, op: Operation): void {
  doc.history.push(op)
  applyOperation(doc.blocs[0], op)
}

export const renderText = (doc: Document) => doc.blocs.map((b) => b.text).join('\n')
