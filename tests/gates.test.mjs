import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const fixtures = {
  sast: [{ runs: [{ results: [] }] }, { runs: [{ tool: { driver: { rules: [
    { id: 'regression', defaultConfiguration: { level: 'error' } },
  ] } }, results: [{ ruleId: 'regression' }] }] }],
  secrets: [[], [{ RuleID: 'regression' }]],
  npm: [{ metadata: { vulnerabilities: {} }, vulnerabilities: {} },
    { metadata: { vulnerabilities: {} }, vulnerabilities: { regression: { name: 'regression', severity: 'high' } } }],
  osv: [{ results: [] }, { results: [{ packages: [{ vulnerabilities: [{ id: 'test', database_specific: { severity: 'HIGH' } }] }] }] }],
  image: [{ Results: [] }, { Results: [{ Vulnerabilities: [{ VulnerabilityID: 'test', Severity: 'HIGH' }] }] }],
  zap: [{ site: [{ alerts: [] }] }, { site: [{ alerts: [{ pluginid: '10038', riskcode: '2', alert: 'CSP absente' }] }] }],
}
for (const [family, [green, red]] of Object.entries(fixtures)) test(`${family}: vert, regression rouge, rapport manquant bloque`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pagespace-gate-'))
  const run = (path) => spawnSync(process.execPath, ['scripts/security/gate.mjs', family, path], { encoding: 'utf8' }).status
  try {
    for (const [value, expected] of [[green, 0], [red, 1], [{ invalid: true }, 2]]) {
      const file = join(dir, 'report.json'); writeFileSync(file, JSON.stringify(value))
      assert.equal(run(file), expected)
    }
    assert.equal(run(join(dir, 'missing.json')), 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
