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
docker compose up --build
```

## API REST

| Methode | Route | Description |
|---|---|---|
| GET | `/api/docs` | liste des documents |
| GET | `/api/docs/:id` | un document (texte rendu) |
| GET | `/api/docs/:id/history` | l'historique des operations |
| GET | `/api/docs/:id/snapshot` | instantane (blocs + version) |
| POST | `/api/docs` | cree un document (`{ "title": "..." }`) |

Donnees de demonstration : `npm run seed` (2 documents, dont un avec un historique).

## Etat de la couche temps reel

La synchronisation temps reel est aujourd'hui un **stub volontairement naif**
(`src/realtime/naive-stub.ts`). Il fonctionne mal, et c'est voulu : voir `TRANSPOSITION.md` pour
ce qui est a corriger et dans quel ordre. Le scenario du probleme de convergence est dans
`src/realtime/piege.scenario.ts` (`npm run scenario`).

## Structure

```
src/domain.ts              entites + application des operations (pur)
src/store.ts               etat en memoire
src/rest.ts                routes Fastify
src/server.ts              point d'entree (REST + front + temps reel)
src/seed.ts                donnees de demonstration
src/realtime/naive-stub.ts    LE stub a remplacer
src/realtime/security-helpers.ts   verification JWT + Origin + RateLimiter (fourni)
src/realtime/convergence.exemple.ts  strategie de convergence adaptee (fourni, a brancher)
src/realtime/piege.scenario.ts  le cas de concurrence a faire converger
public/index.html          front de demonstration (2 onglets = 2 co-editeurs)
docs/adr/                  vos Architecture Decision Records
```

## Sujet

Sujet n° 1 : Éditeur de documents collaboratif

## Choix de push (ADR-1, amorce)

- Sens du flux principal : bidirectionnel.
- Technique envisagée : WebSocket, puis Socket.IO.
- Pourquoi : l’éditeur doit envoyer les opérations de saisie et les positions de curseur du client vers le serveur, tandis que le serveur doit les diffuser immédiatement aux autres utilisateurs du même document. Une communication bidirectionnelle persistante est donc adaptée. Socket.IO permettra ensuite de créer une room par document et de gérer plus facilement les accusés de réception et les reconnexions.
- Pourquoi pas WebRTC pour le flux principal : le serveur doit contrôler, ordonner et conserver les opérations d’édition, ce qui rend une communication principalement pair-à-pair inadaptée.
