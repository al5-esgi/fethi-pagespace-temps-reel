import { writeFile, rm } from 'node:fs/promises'
const file = 'src/security-regression.ts'
if (process.argv.includes('--clean')) {
  await rm(file, { force: true }); console.log('Regression retiree. Relancer les scans puis pousser le correctif.')
} else {
  // Valeur synthetique sans compte ni service associe. Aucun vrai secret n'est introduit.
  const fake = ['demo', 'regression', 'never', 'a', 'credential'].join('-')
  await writeFile(file, `// Regression pedagogique : ne pas fusionner.\nexport const SECRET = '${fake}'\n`, { flag: 'wx' })
  console.log('Regression creee : src/security-regression.ts. Semgrep et Gitleaks doivent bloquer.')
}
