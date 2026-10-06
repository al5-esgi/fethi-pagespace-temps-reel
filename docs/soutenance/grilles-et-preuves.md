# Soutenance commune — matrice des critères

Sources analysées : `~/Downloads/grille-soutenance.html` (Web temps réel) et `grille-soutenance (1).html` (sécurité). Les deux évaluations restent distinctes même dans une soutenance commune : chacune 12 points projet + 8 Q&A. Le professeur attribue la note ; cette matrice organise les preuves nécessaires.

| Cours / critère | Points | Preuve préparée | À démontrer devant le jury |
|---|---|---|---|
| Temps réel : rooms/présence/reconnexion | 3 | ACL doc, présence room, grâce 5 s ; tests TP5/TP7 | Deux navigateurs, présence, reconnexion courte sans faux départ |
| Temps réel : piège de concurrence | 3 | CRDT, 16 tests TP6, mode ?demo=1 | Même snapshot AB, insertions X/Y retenues puis libérées ; même texte sans perte |
| Temps réel : ADR push/convergence | 2 | ADR temps réel 1 et 2 existants | Bidirectionnel vs SSE seul/WebRTC ; positions stables vs offsets/LWW |
| Temps réel : robustesse | 2 | Redis partagé, snapshot/tombstones, ADR3, tests TP7 | Coupure réseau et reprise ; bascule A/B possible |
| Temps réel : démarrage et 2 navigateurs | 2 | Compose image durcie, setup secret local, tests | Services déjà lancés ; démarrage <2 min et démo sans accroc |
| Sécurité : threat model | 3 | DFD + STRIDE H reliées BE/ER | Montrer les frontières et expliquer 2–3 H spécifiques au canal |
| Sécurité : pipeline et build cassé | 4 | 5 familles, seuils, parseurs testés | Vrai run nominal vert, régression synthétique, rouge au step de seuil, finding Security. Publication encore à autoriser |
| Sécurité : audit et ADR-2 | 3 | 5 findings, avant/après, CWE, SEC-2, plan | F-01 en premier ; critères, corrigé/restant et raison |
| Sécurité : registre/SSI | 2 | Registre réel et checklist avec limites explicites | Durées réelles, conservation Redis ouverte, pas de conformité fictive |
| Deux cours : Q&A | 8 + 8 | Entraînement préparé dans questions-reponses.md | Exactitude, justification et raisonnement ; 2 fondamentaux + 2 cas limites par grille |

## Format et points à verrouiller

L'étudiant a confirmé **un passage commun**. Les grilles isolées indiquent 8–9 min et 9–10 min de présentation ; la durée commune est encore à confirmer. Préparer un noyau de 10 minutes, avec annexes pour approfondir, sans supposer que les deux durées s'additionnent.

Backup technique : captures horodatées d'une vraie démo, d'un vrai run vert et rouge ; le backup plafonne les critères live. Environnement, dépôt, Actions et Security ouverts avant le premier passage. Après 2 minutes de tentative de lancement, basculer au backup prévu par les grilles.

Objectif de préparation : tous les critères au niveau Excellent ; pas de promesse de 20/20. La maîtrise orale et les preuves GitHub encore manquantes sont déterminantes.
