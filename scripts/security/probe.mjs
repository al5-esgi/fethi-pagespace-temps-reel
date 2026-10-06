import { writeFile } from 'node:fs/promises'
const target = process.env.PROBE_URL ?? 'http://localhost:3310'
const output = process.env.PROBE_OUTPUT ?? 'docs/security/evidence/after/http.json'
async function token(profileId) {
  const r = await fetch(target + '/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }) })
  if (!r.ok) throw new Error('Connexion de demonstration indisponible')
  return (await r.json()).token
}
const johnny = await token('demo-user'), alice = await token('alice')
const checks = []
for (const suffix of ['', '/history', '/snapshot']) for (const [identity, bearer] of [['anonyme', null], ['johnny', johnny], ['alice', alice]]) {
  const path = '/api/docs/doc-brief' + suffix
  const response = await fetch(target + path, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} })
  checks.push({ path, identity, status: response.status })
}
const page = await fetch(target + '/')
const headers = Object.fromEntries(['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-embedder-policy'].map((name) => [name, page.headers.get(name)]))
const data = { at: new Date().toISOString(), target, checks, headers }
await writeFile(output, JSON.stringify(data, null, 2) + '\n')
console.log(JSON.stringify(data, null, 2))
