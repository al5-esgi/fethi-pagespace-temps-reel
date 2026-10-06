# Politique de mise à jour des dépendances

Décidée le 6 octobre 2026, mainteneur : l'étudiant responsable du dépôt.

## Cadence

- Patch : revue hebdomadaire, sous 48 h pour une vulnérabilité HIGH ; tests avant fusion.
- Mineur : mensuel, changelog et non-régression REST/temps réel.
- Majeur : revue mensuelle, branche dédiée et ADR si contrat modifié ; décision sous 7 jours si correctif de sécurité nécessaire.
- CRITICAL activement exploitée : qualifier le jour même, isoler l'entrée touchée immédiatement, correction ou mesure compensatoire sous 24 h, revue datée.
- Bases conteneur et scanners : contrôle hebdomadaire des versions, digest/SHA mis à jour par PR. Un tag figé sans maintenance vieillit.

## Qui décide

| Montée | Décide | Valide | Trace |
|---|---|---|---|
| Patch/mineur | Mainteneur étudiant | CI et revue du diff | PR + rapports npm/OSV |
| Majeur / changement d'API | Mainteneur avec validation pédagogique si nécessaire | Scénarios à deux clients, tests ACL et cluster | PR, ADR, avant/après |
| Urgence exploitée | Mainteneur, avec responsable de service en usage réel | Contrôle de sécurité puis régression fonctionnelle | Incident, mitigation, PR datée |
| Base/scanner | Mainteneur | SBOM, Trivy, démarrage image et versions officielles | Digest/version dans Git et rapport |

## Lien MCO–MCS

Le MCO couvre disponibilité, reprise et compatibilité : tests CRDT/reconnexion, démarrage et supervision. Le MCS ajoute veille CVE, correction, scan et revue des exceptions. Prévoir une séance de maintenance hebdomadaire de 30 minutes dans le temps projet ; en production un budget et un responsable doivent être désignés.

## Cas réellement traité

Chaîne mesurée : Pagespace → `@fastify/static 8.3.0` → `glob` → `minimatch` → `brace-expansion 5.0.9`. `brace-expansion` a notamment GHSA-qhr7-859c-m2p7 (HIGH, DoS) et GHSA-6j4f-fj2g-mc7p (HIGH). Static possède aussi GHSA-83w8-p2f5-377r (HIGH, path traversal) et trois alertes MODERATE.

npm proposait une montée **majeure** de static vers `10.1.5`. Décision : accepter cette montée compatible avec Fastify 5, puis vérifier tous les lecteurs, CSP et scénarios. `npm audit fix` a aussi corrigé les transitives et Fastify est passé de 5.12.3 à 5.12.5. Lockfile versionné, aucune installation flottante pour la CI.

Avant : npm 4 paquets affectés (2 HIGH/2 MODERATE), OSV 11 signalements sur 5 entrées de paquets. Après : zéro finding npm/OSV sur le lockfile mesuré. Les compteurs diffèrent : npm groupe les paquets ; OSV liste les vulnérabilités et les deux versions de fast-uri séparément. Ne pas les additionner.

L'exploitabilité dépend des routes/options réellement activées : le frontend statique ne contient pas les documents privés et le directory listing est désactivé. Cette nuance réduit certaines préconditions d'exploitation, mais ne justifie pas de laisser une bibliothèque affectée quand une correction validée existe.
