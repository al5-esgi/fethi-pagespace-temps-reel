import { readFileSync } from 'node:fs'
const [family, report] = process.argv.slice(2)
const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url)))
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
let findings = []
try {
  const data = read(report)
  if (family === 'sast') {
    if (!Array.isArray(data.runs) || !data.runs.length) throw new Error('SARIF sans run')
    for (const run of data.runs) {
      if (!Array.isArray(run.results)) throw new Error('SARIF sans results')
      if (run.invocations?.some((i) => i.executionSuccessful === false)) throw new Error('scanner en echec')
      const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]))
      findings.push(...run.results.filter((r) => policy.sast.blockLevels.includes(
        r.level ?? rules.get(r.ruleId)?.defaultConfiguration?.level ?? 'warning')))
    }
  } else if (family === 'secrets') {
    if (!Array.isArray(data)) throw new Error('Gitleaks sans tableau de resultats')
    findings = data
  } else if (family === 'npm') {
    if (data.error || !data.metadata?.vulnerabilities || !data.vulnerabilities) throw new Error('npm audit incomplet')
    findings = Object.values(data.vulnerabilities).filter((v) => policy.npm.blockSeverities.includes(v.severity))
  } else if (family === 'osv') {
    if (!Array.isArray(data.results)) throw new Error('OSV sans results')
    const vulnerabilities = data.results.flatMap((r) => r.packages ?? []).flatMap((p) => p.vulnerabilities ?? [])
    findings = vulnerabilities.filter((v) => {
      const severity = v.database_specific?.severity ?? v.ecosystem_specific?.severity
      if (['HIGH', 'CRITICAL'].includes(severity)) return true
      if (['LOW', 'MODERATE', 'MEDIUM'].includes(severity)) return false
      // OSV n'expose pas toujours un score numerique : on bloque l'inconnu plutot que l'ignorer.
      const score = Number(v.database_specific?.cvss?.score)
      return Number.isFinite(score) ? score >= policy.osv.minimumCvss : policy.osv.blockUnknown
    })
  } else if (family === 'image') {
    if (!Array.isArray(data.Results)) throw new Error('Trivy sans Results')
    findings = data.Results.flatMap((r) => r.Vulnerabilities ?? []).filter((v) => policy.image.blockSeverities.includes(v.Severity))
  } else if (family === 'zap') {
    if (!Array.isArray(data.site) || !data.site.length || data.site.some((s) => !Array.isArray(s.alerts))) throw new Error('ZAP sans site scanne')
    const rules = new Map(readFileSync('.zap/rules.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
      const [id, verdict, reason] = l.split('\t')
      if (!reason || !['IGNORE', 'WARN', 'FAIL'].includes(verdict)) throw new Error(`regle ZAP invalide : ${id}`)
      return [id, verdict]
    }))
    findings = data.site.flatMap((s) => s.alerts ?? []).filter((a) => rules.get(String(a.pluginid)) === 'FAIL' ||
      (Number(a.riskcode) >= policy.zap.minimumRisk && rules.get(String(a.pluginid)) !== 'IGNORE'))
  } else throw new Error(`famille inconnue : ${family}`)
  console.log(`SEUIL ${family} : ${findings.length} finding(s) bloquant(s). Politique : scripts/security/policy.json`)
  // Ne jamais afficher la valeur d'un secret, ni la ligne de code qui le contient.
  for (const finding of findings.slice(0, 10)) console.log(finding.ruleId ?? finding.RuleID ?? finding.name ?? finding.id ?? finding.VulnerabilityID ?? finding.alert)
  process.exitCode = findings.length > (family === 'secrets' ? policy.secrets.maximum : 0) ? 1 : 0
} catch (error) {
  console.error(`SEUIL ${family} : rapport absent/invalide, controle refuse (${error.message})`)
  process.exitCode = 2
}
