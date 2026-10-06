# Rapport d'audit — Pagespace

Audit du 6 octobre 2026. Auteur : mainteneur étudiant. Périmètre : sources `sujet-01-editeur`, routes Fastify, Socket.IO/SSE, état partagé Redis, dépendances npm et image applicative. Référence avant : `cdc7fec`. Rapport spécifique à l'application ; les résultats des scanners sont des preuves complémentaires.

## Synthèse

Cinq findings, priorisés avec SEC-2. Les fuites et la clé connue ont été corrigées. Les limites de stockage/effacement restent ouvertes dans un environnement local à données fictives ; elles sont un prérequis avant usage réel. Aucune promesse de sécurité exhaustive ou de résultat scolaire.

| Rang | ID | Sujet | Sévérité technique / priorité métier | État |
|---|---|---|---|---|
| 1 | F-01 | Accès REST/SSE sans appartenance au document | Haute / P0 | Corrigé et testé |
| 2 | F-02 | Clé JWT connue et mode de login demo | Haute / P0 | Clé/configuration corrigées ; IdP requis avant production |
| 3 | F-04 | Dépendances affectées, dont deux paquets HIGH | Haute / P1 | Corrigé ; npm/OSV zéro finding mesuré |
| 4 | F-03 | Configuration navigateur non durcie | Moyenne / P1 | Corrigée ; styles de curseur résiduels documentés |
| 5 | F-05 | Accumulation de documents/historique/tombstones sans purge | Moyenne en local / P2, P1 avant production | Ouvert, plan daté |

## F-01 — Lecture de documents privés par des canaux secondaires

- Sévérité : haute ; aucun compte requis avant correction, texte/historique divulgués. **CWE-862** (autorisation absente), **CWE-639** (référence directe contrôlée par l'utilisateur).
- Source : revue S-01 ; `src/rest.ts` au commit `cdc7fec` ; preuve `evidence/before/http.json`.
- Scénario **BE1/BE4 → ER1** : le brief appartient à Alice, mais GET docs/doc-brief, history et snapshot renvoyaient 200 à un visiteur ; le SSE global pouvait relayer les autres documents.
- Reproduction : démarrer `cdc7fec` dans une copie temporaire ; appeler ces routes sans Authorization. Après correction, lancer `node scripts/security/probe.mjs` sur l'instance locale : anonyme 401, JWT Johnny 403, JWT Alice 200. `npm run test:security` vérifie aussi liste et filtre du rejeu SSE.
- Recommandation et correction : identité vérifiée, `readAccessibleDocument` au chargement, filtre de liste, propriétaire pris dans le JWT, SSE par docId autorisé ; aucun jeton en URL.
- Risque restant : le mode demo permet intentionnellement de choisir Alice localement. Les ACL démontrent une séparation entre identités authentifiées, pas une protection contre ce choix pédagogique. IdP avant ouverture.

## F-02 — Signature JWT avec une clé connue

- Sévérité : haute ; clé dans le dépôt, capacité d'usurper un collaborateur. **CWE-798** (identifiant codé en dur), **CWE-287** (authentification incorrecte).
- Preuves : Semgrep historique (`evidence/before/semgrep.sarif`), Gitleaks historique masqué (`before/gitleaks.json`), `src/realtime/security-helpers.ts:49` à `cdc7fec`.
- Scénario **BE2/BE1 → ER2/ER1** : signer un sub Alice avec l'ancienne clé puis lire/modifier son document.
- Reproduction : `git show cdc7fec:src/realtime/security-helpers.ts` ; scanners avec les règles locales. Le test JWT signe avec l'ancienne valeur et constate maintenant le rejet, ainsi que l'absence d'exp, mauvaise audience et HS512. La connexion WS est fermée quand exp est atteint.
- Correction : secret aléatoire local ou JWT_SECRET >=32 octets, obligatoire en production/multi-instance, commun A/B ; issuer/audience/algorithme/exp contrôlés, rotation invalidant les anciens jetons.
- Verdict historique : vrai positif devenu inopérant ; seule l'empreinte exacte du commit ancien est exclue. Une nouvelle occurrence n'est pas autorisée. Le mode demo est interdit en production, mais une authentification réelle reste à intégrer.

## F-03 — Configuration navigateur permissive

- Sévérité : moyenne ; augmente l'impact d'une injection mais ne constitue pas une XSS prouvée. **CWE-693** (protection insuffisante), **CWE-1021** (framing).
- Source : ZAP baseline, cible locale du projet. Avant : 8 catégories dont CSP absente 10038, anti-frame absent 10020, nosniff absent 10021, permissions 10063 et isolation 90004. Rapports before/zap.json et after/zap.json.
- Reproduction : ZAP sur les sources avant/après selon `README.md` sécurité ; `probe.mjs` pour les en-têtes. Le contrôle DAST bloque 10038/10020/10021/10098 explicitement.
- Correction : scripts/CSS externes locaux, CSP script-src self, Helmet, CORS restreint, Referrer-Policy, nosniff, framing, COOP/COEP, Permissions-Policy ; bundle Socket.IO servi par Fastify. Origin WS est contrôlé séparément.
- Mesure après : 2 catégories informatives restantes (contenu public cacheable 10049, application moderne 10109), zéro finding bloquant. Vérification navigateur sans erreur CSP.
- Risque résiduel : style-src-attr unsafe-inline pour les curseurs, documenté SEC-1 avec revue le 6 novembre 2026. HSTS n'est activé qu'en production HTTPS ; ne pas faire croire qu'il chiffre le HTTP local.

## F-04 — Dépendances connues vulnérables

- Sévérité : haute au scanner ; exploitabilité de certaines routes/options non démontrée. **CWE-1104** (composant non maintenu), CWEs des advisories : 22/180/400/674 notamment.
- Preuve : `before/npm-audit.json`, `before/osv.json` et lockfile avant. Static 8.3.0 (GHSA-83w8-p2f5-377r HIGH), brace-expansion 5.0.9 (GHSA-qhr7-859c-m2p7 et GHSA-6j4f-fj2g-mc7p HIGH), fast-uri et Fastify MODERATE.
- Reproduction : npm audit et OSV sur le même lockfile avant. npm : 4 paquets affectés ; OSV : 11 signalements sur 5 entrées. Après : même procédure sur package-lock.json actuel, zéro finding des deux outils.
- Correction : static 10.1.5, Fastify 5.12.5 et transitives corrigées. Montée majeure validée avec typecheck, ACL, présence/convergence et cluster. Politique de MAJ et SBOM CycloneDX 128 composants de production.
- Image : multi-stage, runtime distroless 65532, dépendances dev retirées, base par digest, filesystem en lecture seule et capacités retirées. Trivy mesuré : 0 HIGH/CRITICAL, 23 MEDIUM + 8 LOW système, 0 vulnérabilité Node.js. Les alertes basses ne sont pas cachées ; revue hebdomadaire.
- Risque restant : connaissance des bases CVE au jour du scan, dépendances futures et images Redis/nginx hors scan applicatif. Un SBOM est un inventaire, pas un certificat d'innocuité.

## F-05 — Accumulation et conservation sans purge

- Sévérité : moyenne dans le périmètre local ; précondition utilisateur/administrateur local, données fictives. **CWE-400** (ressources non bornées), **CWE-459** (nettoyage incomplet).
- Source : revue `src/domain.ts` (history.push), `DocumentCrdt` (tombstones), RedisState.ensureDocument (SET NX sans EX/PX), volume AOF persistant. **BE3/BE4 → ER3/ER4**.
- Preuve reproductible : rechercher ces appels et constater l'absence de TTL/quotas par document ; l'historique des documents de test continue de croître et un redémarrage des apps conserve Redis. Cette revue prouve l'absence de limite, pas un DoS testé sur le poste.
- Contrôles existants : HTTP/WS 64 Kio, 512 ops/lot, débit, mémoire/CPU de conteneurs ; SSE 100 événements ; grâce présence 5 s et bail 15 s après crash. Ces limites n'instaurent pas une durée documentaire.
- Recommandation : quotas document/utilisateur, compactage avec horizon de reconnexion, suppression des documents/historiques/AOF et procédure d'effacement. Ne pas retirer arbitrairement les tombstones : cela peut ressusciter du texte lors du rejeu.
- Décision : risque accepté temporairement uniquement pour la démo locale fictive ; action R-03 avant usage réel, objectif de conception le 20 octobre 2026. Pas d'exception scanner prétendant que le défaut n'existe pas.

## Limites de l'audit

Pas de pentest externe, IdP, TLS public, haute disponibilité Redis, test destructeur de saturation ni audit légal de production. Les scans passifs ne vérifient pas les ACL/CRDT ; les tests dédiés les complètent. Les runs GitHub et captures ne sont validés que lorsqu'ils sont réellement exécutés et liés dans preuves-ci.md.
