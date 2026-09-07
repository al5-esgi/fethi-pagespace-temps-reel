import { applyOperation, type Bloc } from '../domain.ts'
import { ConvergentText } from './convergence.exemple.ts'

// LE PIEGE de ce sujet : deux insertions concurrentes au meme offset.
// Deux repliques recoivent les memes operations dans un ordre different.
//
//   npm run scenario                  -> avec le STUB : les repliques divergent (sortie != 0)
//   npm run scenario -- --avec-strategie  -> avec le CRDT : elles convergent (sortie 0)

const avecStrategie = process.argv.includes('--avec-strategie')

if (!avecStrategie) {
  // --- STUB : application par offset, dernier ecrivain gagne ---
  const base = 'AB'
  const a: Bloc = { id: 'A', text: base }
  const b: Bloc = { id: 'B', text: base }
  const opX = { type: 'insert' as const, offset: 1, text: 'X', by: 'alice', at: 1 }
  const opY = { type: 'insert' as const, offset: 1, text: 'Y', by: 'bob', at: 2 }
  applyOperation(a, opX); applyOperation(a, opY) // A recoit X puis Y
  applyOperation(b, opY); applyOperation(b, opX) // B recoit Y puis X
  console.log(`base       : "${base}"`)
  console.log(`replique A  : "${a.text}"  (X puis Y)`)
  console.log(`replique B  : "${b.text}"  (Y puis X)`)
  const converge = a.text === b.text
  console.log(converge ? '\nCONVERGE' : '\nDIVERGE  <- le stub ne resout pas ce cas')
  process.exit(converge ? 0 : 1)
} else {
  // --- STRATEGIE : CRDT de sequence ---
  const seedOps = new ConvergentText('seed')
  seedOps.insertLocal(0, 'A')
  seedOps.insertLocal(1, 'B')
  const snap = seedOps.snapshot()

  const a = new ConvergentText('siteA')
  const b = new ConvergentText('siteB')
  a.loadSnapshot(snap)
  b.loadSnapshot(snap)

  const opX = a.insertLocal(1, 'X') // Alice insere X entre A et B
  const opY = b.insertLocal(1, 'Y') // Bob insere Y entre A et B, sans voir X

  a.apply(opY) // A recoit Y
  b.apply(opX) // B recoit X

  console.log(`replique A  : "${a.toString()}"`)
  console.log(`replique B  : "${b.toString()}"`)
  const converge = a.toString() === b.toString()
  console.log(converge ? '\nCONVERGE  (CRDT)' : '\nDIVERGE')
  process.exit(converge ? 0 : 1)
}
