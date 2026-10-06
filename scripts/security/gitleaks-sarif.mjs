import { readFileSync, writeFileSync } from 'node:fs'
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ids = [...new Set(input.map((r) => r.RuleID))]
const results = input.map((r) => ({ ruleId: r.RuleID, level: 'error',
  message: { text: 'Secret potentiel detecte (valeur masquee). Retirer et revoquer avant de justifier une exclusion.' },
  locations: [{ physicalLocation: { artifactLocation: { uri: r.File }, region: { startLine: r.StartLine } } }],
}))
writeFileSync(process.argv[3], JSON.stringify({ version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  runs: [{ tool: { driver: { name: 'Gitleaks', version: '8.30.1', rules: ids.map((id) => ({ id,
    shortDescription: { text: id }, properties: { 'security-severity': '8.0' } })) } }, results }] }, null, 2))
