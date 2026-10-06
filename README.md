# Editeur de documents collaboratif

Un editeur ou plusieurs personnes modifient le meme document en meme temps : le texte des autres
apparait au fur et a mesure, avec (a terme) leurs curseurs et leur selection, un historique des
versions, et un mode hors-ligne leger.

## Demarrer

```bash
npm install
npm start
# http://localhost:3000
```

Avec Docker :

```bash
npm run setup:demo
docker compose up --build -d --wait
```

Le TP7 lance deux éditeurs A/B, Redis et nginx. Ouvrir `http://localhost:3010` pour passer
par le proxy, ou `http://localhost:3101/?profile=alice` et `http://localhost:3102/?profile=bob`
pour constater directement la collaboration entre deux instances.
Le mode `npm run dev` reste une instance unique sur 3000, sans Redis.

```bash
npm run test:tp7
npm run s7:load
# N=500 npm run s7:load  # charge modeste optionnelle
```

Les métriques sont sur `/metrics` de chaque instance, et leur santé sur `/api/health`.
Le test de charge enregistre ses mesures dans `docs/captures/s7/`. Redis utilise un volume
Docker persistant et n'est pas exposé sur un port de l'hôte. `docker compose stop` arrête le TP7.

## Sécurité et soutenance commune

Les TP1 à TP5 de sécurité sont transposés à cet éditeur. Voir [le dossier sécurité](docs/security/README.md),
[l'audit](docs/security/rapport-audit.md) et [la matrice des grilles](docs/soutenance/grilles-et-preuves.md).
`npm run test:security` vérifie les ACL REST/SSE, JWT, Origin WebSocket, expiration et seuils de scan.
Les workflows couvrent SAST, secrets, dépendances, image et DAST, chacun avec un step de seuil explicite.
Les vrais runs GitHub restent à publier après autorisation ; leur statut est dans `docs/security/preuves-ci.md`.

Pour le piège en direct, ouvrir les deux profils avec `&demo=1` : une commande retient les éditions
afin de reproduire deux insertions concurrentes sur le même état, puis les libère. Une seconde commande
ferme réellement le transport du client pendant deux secondes pour montrer la reprise par snapshot.
Les instructions sont dans `docs/soutenance/demo.md`.

REST et SSE exigent maintenant `Authorization: Bearer <JWT>` ; SSE exige aussi `?docId=<id>`.
La liste de documents est filtrée. La création attribue le propriétaire à l'identité du jeton.
Le mode local de profils reste pédagogique : il est interdit en production. L'image durcie exige
une clé externe d'au moins 32 octets en production ; aucun secret de repli n'est fourni.
L'authentification réelle, TLS et la purge documentaire restent nécessaires avant exposition publique.

## Essayer l'éditeur à deux

Ouvrir `http://localhost:3000/?profile=demo-user` et `http://localhost:3000/?profile=alice`
dans deux onglets. Choisir **Notes de reunion** dans les deux : le texte, les curseurs et les
sélections sont partagés en direct. Le sélecteur en haut permet de changer de profil.

Johnny, Alice et Bob peuvent collaborer sur les notes. Seule Alice peut ouvrir **Brief produit**.
Ces profils sont destinés à la démonstration ; le serveur génère leur JWT via `/api/auth/demo`.

```bash
npm run typecheck
npm run test:tp5
npm run scenario
npm run test:tp6
```

Le scénario TP5 vérifie les snapshots, la présence et les curseurs par room, les droits d'accès,
la reconnexion avant cinq secondes et le départ après expiration du délai de grâce. Il démarre
son propre serveur sur un port libre et utilise des documents isolés.
Les captures et les manipulations sont dans [docs/captures/s5/README.md](docs/captures/s5/README.md).

## API REST

| Methode | Route | Description |
|---|---|---|
| GET | `/api/docs` | liste des documents |
| GET | `/api/profiles` | profils de démonstration |
| POST | `/api/auth/demo` | connexion de démonstration (`{ "profileId": "alice" }`) |
| GET | `/api/docs/:id` | un document (texte rendu) |
| GET | `/api/docs/:id/history` | l'historique des operations |
| GET | `/api/docs/:id/snapshot` | instantane (blocs + version) |
| POST | `/api/docs` | cree un document (`{ "title": "..." }`) |

Donnees de demonstration : `npm run seed` (2 documents, dont un avec un historique).

## Etat de la couche temps reel

Les étapes 1 à 7 sont implémentées : SSE rattrapable, serveur WebSocket sécurisé,
rooms Socket.IO, présence avec délai de grâce, curseurs et sélections éphémères,
et snapshot à la connexion. Le CRDT de séquence fourni est branché dans le serveur et le
navigateur : les modifications concurrentes convergent et les renvois sont idempotents.
Les suppressions et les positions stables sont incluses dans le snapshot.
Le stub initial est conservé comme référence. Voir `TRANSPOSITION.md` pour la progression.
`npm run scenario` vérifie la convergence ; `npm run scenario -- --naif` montre l'ancien défaut.
L'ADR-2 et les preuves de validation sont dans `docs/adr/0002-strategie-de-convergence.md`
et `docs/captures/s6/`. Le TP7 ajoute l'adaptateur Redis, un état CRDT et une présence partagés,
deux instances derrière nginx, des identifiants SSE communs et les métriques Prometheus.
Les résultats sont dans `docs/captures/s7/` et l'ADR-3 reste proposée jusqu'aux essais du TP8.

## Structure

```
src/domain.ts              entites + application des operations (pur)
src/store.ts               etat en memoire
src/rest.ts                routes Fastify
src/server.ts              point d'entree (REST + front + temps reel)
src/seed.ts                donnees de demonstration
src/realtime/naive-stub.ts    LE stub a remplacer
src/realtime/security-helpers.ts   verification JWT + Origin + RateLimiter (fourni)
src/realtime/socketio-server.ts    rooms, presence, snapshots et curseurs
src/realtime/s5.scenario.ts        verification automatisee du TP5
src/realtime/document-crdt.ts      adaptateur partage du CRDT fourni
src/realtime/s6.scenario.ts        verification de la convergence et des paquets CRDT
src/realtime/redis-state.ts         etat partage, presence et SSE atomiques
src/realtime/cluster-handlers.ts    edition et presence en multi-instance
src/realtime/metrics.ts             metriques Prometheus par instance
src/realtime/s7.scenario.ts         verification A/B via Redis et proxy
src/realtime/s7.load.ts             mesure de charge locale et export des relevés
src/realtime/convergence.exemple.ts  strategie de convergence adaptee (fourni, a brancher)
src/realtime/piege.scenario.ts  le cas de concurrence a faire converger
public/index.html          front de demonstration (2 onglets = 2 co-editeurs)
scripts/build-client.mjs   genere les modules navigateur avant dev/start
docs/adr/                  vos Architecture Decision Records
```

## Sujet

Sujet n° 1 : Éditeur de documents collaboratif

## Choix de push (ADR-1, amorce)

- Sens du flux principal : bidirectionnel.
- Technique envisagée : WebSocket, puis Socket.IO.
- Pourquoi : l’éditeur doit envoyer les opérations de saisie et les positions de curseur du client vers le serveur, tandis que le serveur doit les diffuser immédiatement aux autres utilisateurs du même document. Une communication bidirectionnelle persistante est donc adaptée. Socket.IO permettra ensuite de créer une room par document et de gérer plus facilement les accusés de réception et les reconnexions.
- Pourquoi pas WebRTC pour le flux principal : le serveur doit contrôler, ordonner et conserver les opérations d’édition, ce qui rend une communication principalement pair-à-pair inadaptée.
