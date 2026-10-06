# Preuves CI et statut vérifié

6 octobre 2026. Ne pas confondre un fichier de workflow présent avec un run réellement exécuté.

## Déjà vérifié localement

- Typecheck et construction des sources.
- 8 tests de sécurité (REST, création, SSE, JWT, Origin, expiration WS, headers, production).
- 6 tests des seuils (chaque test vérifie vert, rouge, rapport invalide et rapport manquant).
- TP temps réel 5/6 : 16 + 16 vérifications ; piège CRDT : convergence.
- TP temps réel 7 : 15 vérifications inter-instances, dont fan-out, concurrence, SSE commun, reconnexion A → B et expiration unique.
- npm, OSV, Semgrep et Gitleaks après qualification : zéro finding bloquant.
- Trivy : aucun HIGH/CRITICAL sur l'image durcie mesurée ; LOW/MEDIUM conservés.
- ZAP : scan exécuté sur sources corrigées, seuil vert ; rapports HTML/JSON/Markdown dans evidence/after.

## À valider sur GitHub

La publication sur le dépôt public a été explicitement autorisée par l’étudiant le 6 octobre 2026. Les premiers runs sont en cours de préparation ; les liens ne sont pas encore des résultats validés.

Dépôt proposé : https://github.com/al5-esgi/fethi-pagespace-temps-reel
Branche nominale : securite-tp1-tp5
Publication proposée : code correctif, workflows/règles, tests et dossier de preuves avec données fictives, puis PR de relecture. Aucun .env, jeton réel, archive image ou node_modules.

Après autorisation : enregistrer les vrais liens vers les runs verts, le run rouge sur branche de démonstration, le finding Security et les artefacts CycloneDX/ZAP/Trivy ; ajouter des captures horodatées. Tant que ces liens manquent, les critères « pipeline exécuté / démo live / Security » sont **préparés mais non acquis**. Aucun run ou finding de Juice Shop n'est une preuve Pagespace.
