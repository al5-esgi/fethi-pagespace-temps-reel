# Transposition temps reel - editeur collaboratif

Ce projet part d'un **stub temps reel naif** (`src/realtime/naive-stub.ts`). A chaque etape,
vous en remplacez une tranche par la technique vue sur le kit de reference. A la fin, le stub
n'est plus importe nulle part.

| Étape | Defaut du stub a corriger | Ce que vous branchez | Cible dans ce projet |
|---|---|---|---|
| 1 | (constat) | rien : vous listez par ecrit ce qui ne va pas | ouvrir 2 onglets, taper, observer : texte melange entre documents, curseurs absents, perte a la reconnexion |
| 2 | diffusion "push tout a tout le monde" | canal **SSE** + buffer borne + `Last-Event-ID` | flux lecture seule de l'historique du document (`op:insert` / `op:delete`) |
| 3 | `WebSocketServer` nu, aucune securite | serveur **`ws`** + handshake JWT + `Origin` + rate-limit | le point d'entree de l'edition |
| 4 | pas de room : tous les documents melanges | **Socket.IO** + room `doc:<id>` + ack sur `op` + autorisation par room | une room par document |
| 5 | pas de presence, pas de curseurs, rechargement total | presence par room + **curseurs / selections** (signal ephemere) + snapshot a la connexion | `cursor:move`, liste des co-editeurs |
| 6 | dernier ecrivain gagne -> divergence | **CRDT de sequence** (positions denses stables) | `src/realtime/piege.scenario.ts` doit converger |
| 7 | instance unique | `@socket.io/redis-adapter` + 2 instances + proxy | fan-out des `op` entre instances |
| 8 | (stub deja remplace) | **WebRTC** : data channel P2P pour le curseur en direct + chaos reseau | curseur P2P entre 2 co-editeurs |

Les ADR correspondants : `docs/adr/0001` (etape 2, acceptee etape 4), `docs/adr/0002` (etape 6), `docs/adr/0003`
(etape 7, acceptee etape 8).

## Code fourni pour vous aider

- `src/realtime/security-helpers.ts` : verification JWT + `Origin` + `RateLimiter` (etape 3), a brancher.
- `src/realtime/convergence.exemple.ts` : la strategie de convergence deja adaptee a ce projet
  (etape 6). Vous la branchez, vous ne la reecrivez pas.
- `src/realtime/piege.scenario.ts` : le cas de concurrence.
  `npm run scenario` reussit avec la strategie branchee ; `npm run scenario -- --naif`
  conserve la demonstration du defaut initial (sortie 1 attendue).

## Constat initial (a remplir a l'etape 1)

Les deux onglets modifient le même texte, même lorsqu’ils sélectionnent des documents différents, car le serveur utilise un unique buffer et ignore le `docId`. Les curseurs ne sont pas partagés, car leur position n’est ni envoyée ni stockée. Au rechargement, seul le texte est restauré : la position du curseur est donc perdue.

## Avancement

Les tranches 1 a 6 du stub sont maintenant remplacees : flux SSE rattrapable, serveur WebSocket
securise, rooms Socket.IO par document, presence avec delai de grace, curseurs et selections
ephemeres affiches directement dans la feuille, profils de demonstration avec droits distincts,
et snapshot complet lors du `join`.

TP6 : le CRDT de sequence fourni est branche via `DocumentCrdt` dans le serveur et le navigateur.
Les lots `crdt:op` transportent des positions stables, les suppressions conservent des tombstones,
et le snapshot transporte l'etat CRDT. Les curseurs utilisent des ancres stables. L'ADR-2 est accepte.
`npm run scenario` converge et `npm run test:tp6` passe ses 16 verifications. Les deux onglets
affichent le meme texte apres des insertions concurrentes (captures dans `docs/captures/s6/`).

TP5 vérifié : `npm run typecheck` et `npm run test:tp5` passent (16 vérifications).
Les captures de snapshot, de reconnexion courte et de départ sont rangées dans
`docs/captures/s5/`, avec les manipulations et résultats dans son `README.md`.
