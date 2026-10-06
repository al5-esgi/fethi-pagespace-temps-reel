# ADR-3 : strategie de robustesse

## Statut
Proposée au TP7 — à confirmer et accepter après les essais du TP8.

## Contexte
Une coupure de moins de cinq secondes doit conserver la présence et la sélection du participant.
Au-delà, un événement `presence-left` doit annoncer son départ. À la reconnexion, le `join`
doit restaurer le texte, les positions CRDT et les suppressions, même si le client arrive sur
une autre instance.

L'adaptateur Redis de Socket.IO diffuse les paquets entre les serveurs mais ne stocke pas les
documents : ajouter l'adaptateur seul laisserait les snapshots diverger entre A et B.
[Documentation de l'adaptateur](https://socket.io/docs/v4/redis-adapter/).

## Options envisagees
- reconnexion + resynchronisation (rejeu du delta ou snapshot)
- fan-out multi-instances via Redis

## Decision
Déployer deux instances A/B derrière nginx avec `ip_hash`, et brancher
`@socket.io/redis-adapter`. L'affinité conserve le serveur de la session HTTP polling ; les
upgrades WebSocket sont relayés et le délai du proxy est supérieur à celui du heartbeat.
[Documentation multi-instance](https://socket.io/docs/v4/using-multiple-nodes/).

Partager aussi les documents et leurs snapshots CRDT dans Redis. Une écriture compare
atomiquement la révision lue et le nouvel état via un script Lua ; si une autre instance a
modifié le document, le lot est réappliqué sur le nouvel état. Cela évite d'écraser une édition
concurrente. Les positions non canoniques sont rejetées. Le navigateur met en attente les
opérations et la présence qui arrivent pendant un `join`, puis les fusionne après le snapshot.

La présence est partagée par document avec des baux renouvelés toutes les trois secondes.
Une déconnexion normale crée un délai de grâce de cinq secondes ; un `join` sur B peut reprendre
la présence créée sur A. Une suppression atomique du membre garantit un seul `presence-left`,
même si les deux serveurs détectent son expiration.

Le flux SSE a un compteur d'événements et un buffer borné à 100 entrées dans Redis.
L'édition du document, l'historique et les événements SSE sont enregistrés dans la même
opération atomique ; `Last-Event-ID` reste utilisable lorsqu'une connexion change d'instance.

Activer AOF dans Redis et un volume Docker nommé. Si `REDIS_URL` est configuré mais Redis
indisponible, le démarrage échoue explicitement ; les écritures partagées indisponibles sont
refusées. Sans `REDIS_URL`, `npm run dev` conserve le mode local à une instance.

## Consequences
Le texte REST, les snapshots tardifs, les curseurs et la présence restent cohérents entre les
instances. Les métriques Prometheus sont exposées sur le même port que chaque application,
avec un label `instance` : connexions actives, connexions/déconnexions cumulées, rooms locales,
lots CRDT, durée serveur du handshake et disponibilité Redis.

Redis est un service commun et ne constitue pas, ici, un cluster hautement disponible.
Le volume AOF protège le redémarrage des applications, pas la perte du disque Redis.
Les documents et historiques sont sérialisés en JSON : ce choix convient au TP, mais les
très grands documents et les tombstones sans collecte demanderaient une structure adaptée.
Les baux actifs expirent après quinze secondes en cas de crash brutal, contre cinq secondes
après une déconnexion détectée. Les connexions Redis arrêtées doivent être réinitialisées
en redémarrant les applications. Le TP8 complétera les essais de chaos et de robustesse.

## Validation TP7

- `npm run test:tp7` : diffusion A/B, concurrence, cohérence REST, déduplication, SSE partagé,
  snapshot tardif, polling sticky, reconnexion A vers B, expiration unique et autorisations.
- `npm run s7:load` : 100 connexions, 50 sur A et 50 sur B, puis retour des jauges à zéro.
- `npm run test:tp5` et `npm run test:tp6` : 32 vérifications de non-régression passent.
- `REDIS_URL=redis://127.0.0.1:1 INSTANCE=fail-startup PORT=0 node --import tsx src/server.ts` :
  échec explicite attendu, sans lancement d'une instance isolée.
- Les captures, métriques brutes et résultats chiffrés sont dans `docs/captures/s7/`.
