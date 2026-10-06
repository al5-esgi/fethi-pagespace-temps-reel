# Dossier sécurité — TP1 à TP5 appliqués à Pagespace

Les grilles attendent des preuves : elles ne sont pas des instructions autorisant une publication externe. L'application est le projet Web temps réel existant, jamais un Juice Shop renommé.

## Parcours et livrables

| TP | Transposition réelle | Livrables |
|---|---|---|
| 1 | Contexte de l'éditeur, biens/événements, build et tests | contexte.md ; ci.yml ; références de preuves-ci.md |
| 2 | DFD REST/SSE/WS/Redis et priorités H reliées BE/ER | threat-model.md |
| 3 | Semgrep p/ci + règles ciblées, Gitleaks historique masqué, triage et régression synthétique | sast.yml ; .semgrep ; .gitleaks.toml/ignore ; triage-s3.md |
| 4 | npm + OSV même lockfile, CycloneDX, Trivy image depuis sources, runtime non root | supply-chain.yml ; Dockerfile.hardened ; politique-maj.md ; rapports avant/après |
| 5 | ZAP sur les sources construites, ACL objet et configuration sûre, mesures | dast.yml ; .zap/rules.tsv ; SEC-1 ; tests et rapport |
| Grille soutenance | Audit 5 findings, SEC-2, registre et documentation, remédiation, entraînement | rapport-audit.md ; registre-traitements.md ; doc-ssi-checklist.md ; plan-remediation.md ; docs/soutenance |

## Pipeline et décision de blocage

| Famille/job | Outil | Step de seuil explicite |
|---|---|---|
| SAST | Semgrep 1.179.0, p/ci et règles locales | Seuil SAST — zéro ERROR SARIF |
| Secrets | Gitleaks 8.30.1, fetch-depth 0, historique atteignable depuis HEAD, redact | Seuil secrets — zéro résultat non qualifié |
| SCA | npm audit et OSV 2.6.0 | Seuil npm HIGH/CRITICAL ; Seuil OSV HIGH/CRITICAL/CVSS>=7 ou inconnu |
| Image | Trivy 0.75.0 sur archive de l'image construite | Seuil image — zéro HIGH/CRITICAL |
| DAST | ZAP 2.17.0 baseline sur sources construites | Seuil DAST — MEDIUM+ ou règle FAIL, sauf exception versionnée |

Les rapports sont publiés **avant** le step de seuil et conservés 7 jours comme artefacts. Semgrep, Gitleaks et Trivy publient SARIF dans Security. `scripts/security/policy.json` centralise les seuils ; `gate.mjs` lit réellement les findings et refuse un rapport absent/invalide. Les codes des scanners ne décident pas seuls le verdict. `tests/gates.test.mjs` vérifie vert, rouge, invalide et manquant pour les six parseurs.

Chaque branche poussée est analysée avec tout son historique atteignable depuis HEAD ; la branche rouge pédagogique ne contamine pas le run nominal. Retirer une clé dans un commit ultérieur ne la retire pas de cet historique.

Un job rouge : ouvrir le step de seuil, télécharger le rapport, qualifier le finding avec CWE/BE/ER, corriger et retester ou justifier une exception ciblée. Pas de suppression globale de règle, de seuil ou de continue-on-error pour maquiller du vert. ZAP baseline ne teste ni les ACL ni la convergence ; les tests applicatifs complètent le crawl passif.

## Reproduire localement

```bash
npm ci
npm run build
npm run typecheck
npm run test:security
npm run test:tp5
npm run test:tp6
npm run scenario
npm run setup:demo
# génère .env hors Git avec la même clé aléatoire pour A/B
docker compose up --build -d --wait
npm run test:tp7
```

Connexion locale : localhost:3010, ou A/B localhost:3101 et :3102. Les sorties actuelles sont dans `evidence/after/`. `Dockerfile.ci` conserve le Dockerfile initial non durci comme contre-exemple ; seul Dockerfile/Dockerfile.hardened est utilisé pour les livraisons.

Mesures HTTP sans afficher les jetons :

```bash
PROBE_URL=http://localhost:3101 node scripts/security/probe.mjs
npm audit --json > .security-reports/npm-audit.json
node scripts/security/gate.mjs npm .security-reports/npm-audit.json
npm sbom --sbom-format=cyclonedx --omit=dev > .security-reports/sbom.cdx.json
```

Pour ZAP, scanner un serveur du commit courant. Sur macOS, remplacer localhost par host.docker.internal dans la cible conteneur ; sur le runner Linux, utiliser --network=host et localhost. Les règles sont lues par notre gate, donc le scanner reste en observation et le **step de seuil séparé** prend la décision :

```bash
mkdir -p .security-reports
# le dossier monté doit être accessible en écriture à l'utilisateur ZAP
docker run --rm -v "$PWD/.security-reports:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:2.17.0 zap-baseline.py \
  -t http://host.docker.internal:3101 -m 1 -J zap.json -r zap.html -w zap.md -I
node scripts/security/gate.mjs zap .security-reports/zap.json
```

Un code ZAP 1/2 peut signifier alertes alors que le gate donne un verdict détaillé ; un crash ou un rapport manquant échoue. Les workflows complets donnent les commandes exactes des autres scans. L'image est exportée puis scannée, sans donner accès au socket Docker au conteneur Trivy.

## Avant / après

- HTTP : brief anonyme 200 → 401 ; Johnny authentifié 403 ; Alice 200.
- Semgrep ciblé : clé connue détectée avant, zéro finding bloquant après.
- Gitleaks : ancienne clé historique détectée, invalidée puis seule empreinte qualifiée ; nouveaux secrets toujours bloqués.
- npm : 4 paquets affectés (2 HIGH/2 MODERATE) → 0 ; OSV : 11 signalements sur 5 entrées → 0.
- ZAP : 8 catégories → 2 informations sur contenu public, zéro finding bloquant.
- SBOM : CycloneDX, 128 composants de production mesurés.
- Image après : 0 HIGH/CRITICAL, 23 MEDIUM et 8 LOW système ; pas une image sans aucune alerte.

Les bases CVE évoluent : les chiffres sont datés, le pipeline doit être relancé avant la soutenance. Les anciens rapports ne prouvent pas l'état d'un nouveau commit.

## Risques restants

Mode demo uniquement local, IdP et TLS avant production ; Redis sans ACL/TLS, pas de purge/quota documentaire/compactage des tombstones, journal non immuable ; styles de curseurs inline. Registre et plan les indiquent honnêtement. Les métriques sont désactivées en production ; l'image exige une clé de déploiement >=32 octets. L'ancienne clé n'est jamais une valeur de repli.

Sources des outils : [Semgrep](https://github.com/semgrep/semgrep/releases/tag/v1.179.0), [Gitleaks](https://github.com/gitleaks/gitleaks), [OSV](https://github.com/google/osv-scanner), [ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/), [SARIF et Security](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts). Les liens GitHub de runs sont exclusivement ceux vérifiés dans preuves-ci.md.
