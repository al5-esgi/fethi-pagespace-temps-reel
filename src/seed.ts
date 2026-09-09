import { createDocument, recordAndApply, type Document, type Operation } from './domain.ts'

// Donnees de demarrage : 2 documents, dont un avec un historique d'operations.

export function buildSeed(): Map<string, Document> {
  const docs = new Map<string, Document>()

  const notes = createDocument('doc-notes', 'Notes de reunion', 'Ordre du jour :\n- ', 'demo-user')
  docs.set(notes.id, notes)

  const brief = createDocument('doc-brief', 'Brief produit', '', 'alice')
  const phrases = [
    'Le produit ',
    'permet de ',
    'collaborer ',
    'en temps reel. ',
    'Chaque edition ',
    'est visible ',
    'immediatement.',
  ]
  let offset = 0
  for (let i = 0; i < phrases.length; i++) {
    const op: Operation = {
      type: 'insert',
      offset,
      text: phrases[i],
      by: i % 2 === 0 ? 'alice' : 'bob',
      at: Date.now() - (phrases.length - i) * 60_000,
    }
    recordAndApply(brief, op)
    offset += phrases[i].length
  }
  docs.set(brief.id, brief)

  return docs
}

if (process.argv.includes('--print')) {
  for (const doc of buildSeed().values()) {
    console.log(`\n# ${doc.title} (${doc.id}) - ${doc.history.length} operations`)
    console.log(doc.blocs[0].text)
  }
}
