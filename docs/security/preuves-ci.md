# Preuves CI vérifiées — Pagespace

6 octobre 2026. Dépôt : [al5-esgi/fethi-pagespace-temps-reel](https://github.com/al5-esgi/fethi-pagespace-temps-reel). Publication expressément autorisée par l'étudiant. [PR de sécurité #1](https://github.com/al5-esgi/fethi-pagespace-temps-reel/pull/1), branche `securite-tp1-tp5` ; non fusionnée dans main pour relecture.

## Nominal réellement vert

Source validée : `f2754d526a0aee35c751b6021329cab197a82d9c`.

| Workflow | Résultat vérifié | Preuve |
|---|---|---|
| ci | Build/typecheck, sécurité et scénarios solo/cluster verts | [run CI](https://github.com/al5-esgi/fethi-pagespace-temps-reel/actions/runs/37455343323) |
| sast | Semgrep + Gitleaks, seuils et SARIF verts | [run SAST](https://github.com/al5-esgi/fethi-pagespace-temps-reel/actions/runs/37455343359) |
| supply-chain | npm + OSV, SBOM et image Trivy verts | [run supply-chain](https://github.com/al5-esgi/fethi-pagespace-temps-reel/actions/runs/37455343272) |
| dast | ZAP sur les sources construites, rapport et seuil verts | [run DAST](https://github.com/al5-esgi/fethi-pagespace-temps-reel/actions/runs/37455343350) |

Les mêmes quatre workflows ont également passé sur la PR. Les artefacts téléchargeables sont listés dans leurs runs : `semgrep-sarif`, `gitleaks-redacted`, `dependency-reports`, `sbom-cyclonedx`, `trivy-image`, `zap-baseline-report`. Le SBOM GitHub a été téléchargé et vérifié : CycloneDX, 128 composants de production. Conservation des artefacts : 7 jours ; les copies/captures versionnées constituent le secours au-delà.

## Régression réellement rouge

Branche **à ne pas fusionner** : `demo/securite-regression-20261006`, commit `1db27c4ac94785bbf8f7d1a8b942a623cc4de230`. Fichier source de deux lignes, clé entièrement fictive, aucun compte/service associé.

[Run rouge SAST et secrets](https://github.com/al5-esgi/fethi-pagespace-temps-reel/actions/runs/37455345724) : seuls les deux steps suivants échouent en code 1, après production et publication des rapports :

- **Seuil SAST - zero ERROR**, règle `semgrep.pagespace-hardcoded-jwt-secret`, CWE-798.
- **Seuil secrets - zero secret non qualifie**, règle `pagespace-jwt-literal`.

Les autres workflows de cette branche (CI, supply-chain et DAST) sont verts. La démo prouve le blocage ciblé, pas un incident d'archivage ni une panne de compilation.

Findings réellement publiés, ligne 2 de `src/security-regression.ts` : [Semgrep #33](https://github.com/al5-esgi/fethi-pagespace-temps-reel/security/code-scanning/33) et [Gitleaks #34](https://github.com/al5-esgi/fethi-pagespace-temps-reel/security/code-scanning/34). Les détails et étapes ont été vérifiés par l’API officielle et dans le navigateur connecté : Semgrep Critical/CWE-798, Gitleaks High, ligne 2 et step de seuil retournant un finding bloquant puis code 1. Les données officielles sont dans `evidence/github/pipeline-results.json`.

**Accès à préparer avant la soutenance** : se connecter à GitHub avec le compte ayant les droits sur le dépôt. Sans connexion, Security peut afficher 404 et les logs demandent Sign in. La branche par défaut reste main : filtrer les alertes sur la branche de démonstration ou ouvrir directement les deux liens ci-dessus. Ne pas confondre une vue sans droits/filtrée sur main avec l'absence de scan.

## Captures et traces authentiques

- `evidence/github/run-vert.jpg` et `run-rouge.jpg` : captures de vraies pages Actions, horodatage du run visible, pas des images reconstituées.
- `evidence/github/pipeline-results.json` : états, SHA, dates, steps rouges et findings officiels.
- `evidence/github/finding-semgrep.jpg`, `finding-gitleaks.jpg`, `step-seuil-rouge.jpg` et browser-security-proof.json : captures et lecture authentiques de Security/Actions avec le compte connecté.
- `evidence/after/convergence-alice.jpg`, `convergence-johnny.jpg` et browser-proof.json : deux clients, même AXYB après éditions indépendantes.
- Rapports bruts des cinq familles dans before/after ; tests de sécurité, seuils, présence/convergence et cluster ; production réelle : login demo/profiles/metrics 404, HSTS présent et utilisateur 65532.
- `evidence/manifest.json` : empreintes SHA-256 des fichiers de preuve, sans normaliser les rapports bruts.

Après toute modification fonctionnelle ou de politique : relancer les workflows du nouveau commit. Les preuves ci-dessus restent datées et rattachées à leur SHA ; elles ne prétendent pas valider des changements futurs.
