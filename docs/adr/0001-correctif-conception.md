# SEC-1 — Appartenance au chargement et configuration sûre

Accepté et implémenté le 6 octobre 2026. Distinct de l'ADR temps réel 1 (push).

## Contexte

F-01/S-01 : REST exposait le brief alors que Socket.IO interdisait sa room. Scénario **BE1/BE4 → ER1** : divulgation d'un document réservé. Le TP5 demande un correctif de conception mesuré.

## Décision

L'identité vient d'un JWT validé. `readAccessibleDocument(store, shared, id, userId)` ne retourne l'objet qu'à son propriétaire ou collaborateur. Les lecteurs REST et SSE utilisent ce chargement ; liste filtrée, propriétaire à la création imposé par le JWT, événements/rejeu SSE limités au document. Les rooms et opérations conservent leurs ACL.

Le second correctif durcit les défauts de configuration : secret externe/aléatoire, production refusée sans clé, demo désactivée en production, Origin WS, limites de taille/débit, expiration de connexion, CSP et en-têtes Fastify/Engine.IO. Le bundle client Socket.IO est servi par Fastify pour recevoir les protections HTTP.

## Options écartées

- Masquer le brief dans le frontend : la route reste directement appelable. Rustine rejetée.
- Vérifier seulement la room ou une liste dans le JWT : ne couvre pas REST/SSE, droits potentiellement périmés. L'objet courant reste l'autorité.
- Copier la vérification dans chaque lecteur : un nouveau handler peut l'oublier. Chargement commun, tests et règle SAST.
- CORS seul pour WS : contrôle Origin explicite du handshake ; les clients sans Origin doivent toujours prouver un JWT.
- Conserver les scripts inline avec script-src unsafe-inline : externalisation simple, donc exception rejetée.

## Mesures

Avant : 200 sur toutes les lectures anonymes du brief (`evidence/before/http.json`). Après : 401 anonyme, 403 JWT Johnny, 200 JWT Alice. Tests : liste, propriétaire, SSE, paquets invalides, expiration et Origin. ZAP : 8 catégories d'alertes avant, 2 informations sur les fichiers publics après.

## Conséquences et risques résiduels

REST/SSE exigent un Bearer. Un EventSource natif ne permet pas ce header : utiliser fetch streaming. Aucun JWT dans une URL. Le frontend s'authentifie avant de charger les documents.

Au 6 octobre 2026, choisir un profil reste une facilité locale de démonstration, pas une identité réelle. IdP, HTTPS et revue des données sont nécessaires avant exposition. `style-src-attr unsafe-inline` reste pour les positions/couleurs dynamiques des curseurs ; script-src reste strict. Risque d'injection de styles résiduel, revue au 6 novembre 2026 pour une approche sans attributs inline.

Redis interne sans ACL/TLS, absence de purge et journal non immuable restent dans le plan de remédiation. Ils ne sont pas présentés comme corrigés.
