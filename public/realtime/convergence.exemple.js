// Genere par npm run build:client. Source : src/realtime/
// STRATEGIE DE CONVERGENCE (exemple fourni, adapte a ce projet).
//
// CRDT de sequence : chaque caractere recoit une position dense et stable. Deux insertions
// concurrentes au meme endroit obtiennent des positions differentes -> ordre deterministe,
// quel que soit l'ordre de reception.
//
// Pour l'activer (etape 6) : dans src/server.ts, remplacez l'appel a startNaiveStub par une
// diffusion d'operations `CharOp` a la room du document, appliquees via `ConvergentText`.
// Vous NE reecrivez pas ce fichier : vous le branchez.
function comparePos(a, b) {
    const len = Math.max(a.path.length, b.path.length);
    for (let i = 0; i < len; i++) {
        const x = a.path[i] ?? 0;
        const y = b.path[i] ?? 0;
        if (x !== y)
            return x - y;
    }
    return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}
const BASE = 1000;
function genBetween(before, after, site) {
    const lo = before?.path ?? [];
    const hi = after?.path ?? [];
    const path = [];
    let depth = 0;
    while (true) {
        const l = lo[depth] ?? 0;
        const h = hi[depth] ?? BASE;
        if (h - l > 1) {
            path.push(l + 1 + Math.floor(Math.random() * (h - l - 1)));
            return { path, site };
        }
        path.push(l);
        depth++;
    }
}
/** Un bloc de texte qui converge. Une instance par (document, client). */
export class ConvergentText {
    site;
    chars = [];
    constructor(site) {
        this.site = site;
    }
    /** Insertion LOCALE a l'index visible ; renvoie l'op a diffuser a la room. */
    insertLocal(index, value) {
        const before = this.chars[index - 1]?.pos ?? null;
        const after = this.chars[index]?.pos ?? null;
        const pos = genBetween(before, after, this.site);
        this.apply({ type: 'insert', pos, value });
        return { type: 'insert', pos, value };
    }
    /** Suppression LOCALE a l'index visible ; renvoie l'op a diffuser. */
    deleteLocal(index) {
        const entry = this.chars[index];
        if (!entry)
            return null;
        this.apply({ type: 'delete', pos: entry.pos });
        return { type: 'delete', pos: entry.pos };
    }
    /** Op RECUE d'un autre client. Idempotente et commutative. */
    apply(op) {
        let i = 0;
        while (i < this.chars.length && comparePos(this.chars[i].pos, op.pos) < 0)
            i++;
        const same = this.chars[i] && comparePos(this.chars[i].pos, op.pos) === 0;
        if (op.type === 'insert') {
            if (same)
                return; // deja applique
            this.chars.splice(i, 0, { pos: op.pos, value: op.value ?? '' });
        }
        else if (same) {
            this.chars.splice(i, 1);
        }
    }
    toString() {
        return this.chars.map((c) => c.value).join('');
    }
    /** Snapshot pour un arrivant tardif (etape 5). */
    snapshot() {
        return this.chars.map((c) => ({ type: 'insert', pos: c.pos, value: c.value }));
    }
    loadSnapshot(ops) {
        for (const op of ops)
            this.apply(op);
    }
}
