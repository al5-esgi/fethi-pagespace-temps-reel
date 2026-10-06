import { ConvergentText, type CharOp, type Position } from './convergence.exemple.ts'

export interface TextChange {
  kind: 'insert' | 'delete'
  offset: number
  text?: string
  length?: number
}

const positionKey = (pos: Position): string => JSON.stringify([pos.path, pos.site])

export function comparePosition(a: Position, b: Position): number {
  for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) {
    const difference = (a.path[i] ?? 0) - (b.path[i] ?? 0)
    if (difference) return difference
  }
  return a.site < b.site ? -1 : a.site > b.site ? 1 : 0
}

// Deux positions concurrentes peuvent partager leur chemin numerique. Le site reste alors
// une coordonnee dense : cette extension permet une edition ulterieure entre les deux.
function siteBetween(before: string, after: string, unique: string): string {
  let prefix = ''
  let upperBounded = true
  for (let depth = 0; ; depth++) {
    const low = before.charCodeAt(depth) || 0
    const high = upperBounded && depth < after.length ? after.charCodeAt(depth) : 65_535
    if (high - low > 1) return prefix + String.fromCharCode(low + 1) + unique
    prefix += String.fromCharCode(low)
    if (high > low) upperBounded = false
  }
}

/** Adaptateur de la strategie fournie, partage par le serveur et les navigateurs.
 * Les suppressions sont gardees comme tombstones pour ignorer une insertion recue en retard.
 * Les offsets exposes sont en unites UTF-16, comme selectionStart/selectionEnd du textarea.
 */
export class DocumentCrdt {
  private text: ConvergentText
  private deleted = new Map<string, Position>()
  private sequence = 0

  constructor(private readonly site: string) {
    this.text = new ConvergentText(site)
  }

  toString(): string { return this.text.toString() }

  visibleEntries(): CharOp[] { return this.text.snapshot() }

  anchorAt(offset: number): Position | null {
    let previous: Position | null = null
    let visibleOffset = 0
    for (const entry of this.text.snapshot()) {
      if (visibleOffset >= offset) break
      previous = entry.pos
      visibleOffset += entry.value!.length
    }
    return previous
  }

  offsetForAnchor(anchor: Position | null): number {
    if (!anchor) return 0
    let offset = 0
    for (const entry of this.text.snapshot()) {
      if (comparePosition(entry.pos, anchor) > 0) break
      offset += entry.value!.length
    }
    return offset
  }

  snapshot(): CharOp[] {
    return [...this.text.snapshot(), ...[...this.deleted.values()].map((pos) => ({ type: 'delete' as const, pos }))]
  }

  loadSnapshot(ops: CharOp[]): void {
    this.text = new ConvergentText(this.site)
    this.deleted.clear()
    for (const op of ops) this.apply(op)
  }

  apply(op: CharOp): TextChange | null {
    const key = positionKey(op.pos)
    const entries = this.text.snapshot()
    const existingIndex = entries.findIndex((entry) => positionKey(entry.pos) === key)
    if (op.type === 'delete') {
      this.deleted.set(key, op.pos)
      if (existingIndex < 0) return null
      const offset = entries.slice(0, existingIndex).reduce((total, entry) => total + entry.value!.length, 0)
      const length = entries[existingIndex].value!.length
      this.text.apply(op)
      return { kind: 'delete', offset, length }
    }
    if (this.deleted.has(key) || existingIndex >= 0) return null
    this.text.apply(op)
    const index = this.text.snapshot().findIndex((entry) => positionKey(entry.pos) === key)
    const offset = this.text.snapshot().slice(0, index).reduce((total, entry) => total + entry.value!.length, 0)
    return { kind: 'insert', offset, text: op.value! }
  }

  insertLocal(offset: number, value: string): CharOp[] {
    const result: CharOp[] = []
    const entries = this.text.snapshot()
    let index = 0
    let visibleOffset = 0
    while (index < entries.length && visibleOffset < offset) {
      visibleOffset += entries[index].value!.length
      index++
    }
    for (const character of value) {
      const current = this.text.snapshot()
      const before = current[index - 1]?.pos
      const after = current[index]?.pos
      const unique = `${this.site}:${++this.sequence}`
      const op = this.text.insertLocal(index, character)
      this.text.apply({ type: 'delete', pos: op.pos })
      op.pos.site = unique
      if (before && after && (comparePosition(before, op.pos) >= 0 || comparePosition(op.pos, after) >= 0)) {
        op.pos = { path: [...before.path], site: siteBetween(before.site, after.site, unique) }
      }
      this.apply(op)
      result.push(op)
      index++
    }
    return result
  }

  deleteLocal(offset: number, length: number): CharOp[] {
    const result: CharOp[] = []
    let visibleOffset = 0
    for (const entry of this.text.snapshot()) {
      const end = visibleOffset + entry.value!.length
      if (end > offset && visibleOffset < offset + length) {
        const op: CharOp = { type: 'delete', pos: entry.pos }
        this.apply(op)
        result.push(op)
      }
      visibleOffset = end
    }
    return result
  }
}

/** Validation des paquets reseau : un lot est entierement valide avant toute mutation. */
export function parseCharOps(raw: unknown): CharOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10_000) return null
  const result: CharOp[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null
    const op = value as CharOp
    if (op.type !== 'insert' && op.type !== 'delete') return null
    if (!op.pos || typeof op.pos.site !== 'string' || !op.pos.site || op.pos.site.length > 1_024 || /\p{Surrogate}/u.test(op.pos.site) ||
        !Array.isArray(op.pos.path) || op.pos.path.length === 0 || op.pos.path.length > 128 ||
        !op.pos.path.every((digit) => Number.isSafeInteger(digit) && digit >= 0 && digit <= 1_000) ||
        op.pos.path.at(-1) === 0) return null
    if (op.type === 'insert' && (typeof op.value !== 'string' || [...op.value].length !== 1 || /\p{Surrogate}/u.test(op.value))) return null
    result.push({ type: op.type, pos: { path: [...op.pos.path], site: op.pos.site },
      ...(op.type === 'insert' ? { value: op.value } : {}) })
  }
  return result
}
