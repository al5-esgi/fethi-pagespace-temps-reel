# Démonstration commune — répétition et secours

Une présentation de 10 minutes est le noyau proposé tant que le professeur n'a pas confirmé la durée commune. Ne pas additionner automatiquement les durées de deux grilles.

## Avant le passage

```bash
npm ci
npm run setup:demo
docker compose up --build -d --wait
npm run test:security
npm run test:tp7
```

Garder les services démarrés. Ouvrir deux navigateurs ou fenêtres distinctes :

- A : http://localhost:3101/?profile=alice&demo=1
- B : http://localhost:3102/?profile=demo-user&demo=1

Préparer dépôt, Actions, un vrai run nominal vert et Security. Les liens et captures sont dans preuves-ci.md ; tant qu'ils ne sont pas renseignés, le volet GitHub n'est pas validé.

## 1. Nominal et droits

Choisir Notes de reunion des deux côtés ; voir les deux collaborateurs. Écrire une courte phrase dans A et constater la réception dans B. Montrer curseur/sélection et préciser que ces événements ne deviennent pas des opérations d'historique. Alice peut sélectionner Brief produit ; Johnny ne le voit pas. Pour prouver la sécurité serveur, montrer le résultat de probe.mjs : 401 anonyme, 403 Johnny, 200 Alice.

## 2. Piège concurrent reproductible

1. Remplacer le texte de Notes de reunion par **AB** dans A. Attendre AB dans B.
2. Cliquer **Mettre les éditions en attente** dans les deux navigateurs.
3. Dans A, insérer **X** entre A et B : AXB. Dans B, insérer **Y** au même endroit : AYB. Les deux opérations ont été produites à partir du même snapshot.
4. Cliquer **Libérer les éditions** dans A puis B. Vérifier les deux textes identiques, AXYB ou AYXB selon l'ordre total des identifiants de sites : les deux caractères sont conservés.
5. Expliquer : positions stables et ordre total, pas offsets absolus ; un renvoi d'opération est idempotent, les tombstones évitent la résurrection.

La commande retient seulement l'envoi des opérations CRDT : aucun contrôle de JWT, ACL ou taille n'est contourné. L'état local divergent avant libération est attendu, la convergence après livraison est la preuve.

## 3. Coupure et reprise

Cliquer **Coupure de 2 secondes** dans A : le transport est fermé, le statut passe en reconnexion, l'édition est suspendue. Écrire **Z** dans B pendant la coupure. A se reconnecte, reçoit un snapshot et retrouve Z. B ne doit pas annoncer de départ pendant la grâce de 5 secondes. Les tests TP7 prouvent aussi la reprise A → B et un départ unique après expiration.

La commande provoque une vraie fermeture du transport du client, puis une reprise programmée. Pour une panne réseau extérieure : utiliser le mode Offline des outils de développement du navigateur ; le désactiver avant le snapshot. Ne pas couper le Wi-Fi si cela coupe aussi l'accès GitHub pendant la démonstration CI.

## 4. Pipeline qui casse — à réaliser après publication autorisée

Depuis la branche nominale propre, créer une **nouvelle** branche de démo pour chaque répétition, sans réécrire l'historique d'une branche utilisée par d'autres :

```bash
git switch -c demo/securite-regression-<date-heure>
npm run security:regression
git add src/security-regression.ts
git commit -m 'demo: regression synthetique de cle JWT'
git push -u origin HEAD
```

Montrer le run Semgrep/Gitleaks et le **step de seuil** rouge, puis le finding avec règle, CWE, fichier/ligne et impact dans Security. Ce n'est pas un vrai secret : aucune identité ou service externe associé. Il déclenche les mêmes contrôles qu'un secret de code.

Revenir à la branche nominale :

```bash
git switch securite-tp1-tp5
```

Le fichier de régression n'y existe pas et l'historique nominal est propre. **Ne pas fusionner la branche rouge.** Retirer un secret dans un commit suivant ne le retire pas de l'historique Gitleaks : rotation et qualification exacte sont nécessaires. `security:regression -- --clean` ne sert qu'à retirer une régression locale non commitée ; ce n'est pas une purge d'historique.

Ne pas afficher .env, les JWT, des identifiants réels ni le contenu d'un secret. Ne pas désactiver un job pour obtenir le vert.

## Backup

Captures locales : `docs/security/evidence/after/convergence-*.jpg` et browser-proof.json. Captures GitHub vert/rouge : à prendre uniquement après vrais runs. Garder une vidéo/capture de la coupure si possible ; pas de capture reconstituée. Lancement raté : au plus 2 minutes de tentative, puis backup avec barème réduit conformément aux grilles.

## Ordre oral proposé (10 minutes)

| Temps | Sujet et preuve |
|---|---|
| 0:00–1:15 | Besoin métier, rooms, transport bidirectionnel, architecture A/B/Redis |
| 1:15–2:15 | BE/ER et trois H sur les frontières REST/WS/Redis |
| 2:15–4:45 | Deux clients, concurrence retenue/libérée, coupure/snapshot |
| 4:45–7:15 | Run vert, régression rouge, step de seuil, finding Security |
| 7:15–8:45 | F-01 avant/après, critères SEC-2, alternatives des ADR |
| 8:45–9:30 | Registre, durées réelles et limites assumées/plan |
| 9:30–10:00 | Marge et transition aux questions |

Les temps se valident par répétition, surtout la latence du pipeline. Une soutenance de 15–20 minutes permet de détailler les alternatives et la chaîne de dépendances ; les Q&A restent séparées du chronomètre de présentation.
