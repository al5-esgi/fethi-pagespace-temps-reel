# ADR-2 : strategie de convergence

## Statut
Acceptée — TP6.

## Contexte
Deux participants partent du texte `AB` et insèrent chacun une lettre à l'offset 1, sans voir
l'édition de l'autre. Si les opérations ne contiennent qu'un offset, un onglet obtient `AYXB`
et l'autre `AXYB` selon l'ordre de réception. Un numéro de version ou un simple rafraîchissement
ne préserve pas, à lui seul, l'intention de ces éditions concurrentes.

## Options envisagees
- OT (operational transformation)
- CRDT
- snapshot + delta numerote
- boucle serveur autoritaire a tick fixe
- throttle / smoothing

## Decision
Utiliser le **CRDT de séquence à positions denses stables** fourni dans
`src/realtime/convergence.exemple.ts`. Ce fichier est conservé sans modification et branché
par l'adaptateur `DocumentCrdt`, utilisé aussi bien sur le serveur que dans le navigateur.

Chaque caractère a une position `{ path, site }`. Les navigateurs appliquent leur édition
localement, puis diffusent un lot de `CharOp` avec `crdt:op`. Les autres répliques fusionnent
ces positions : l'ordre de livraison des insertions ne change pas le texte final.
Le serveur contrôle le JWT et la room, applique les mêmes opérations, puis met à jour le texte
exposé par REST, l'historique et les événements SSE. L'auteur est issu du JWT.

Les suppressions sont conservées sous forme de **tombstones** dans l'adaptateur : une insertion
reçue après sa suppression ne ressuscite pas le caractère. Les snapshots de `join` transportent
les caractères et ces suppressions. Les identifiants de sites sont uniques par réplique et
par opération. Si deux positions ont le même chemin numérique, un site intermédiaire permet
de continuer à écrire entre elles.

Les curseurs restent éphémères. Leurs ancres désignent des positions stables ; les offsets
d'affichage sont recalculés dans chaque réplique, y compris lorsqu'elle a déjà des éditions
locales en attente. Les offsets du textarea restent exprimés en UTF-16, en conservant les
caractères Unicode complets dans le CRDT.

OT aurait demandé de maintenir des transformations et des versions de contexte pour chaque
opération. Snapshot + delta convient au rattrapage d'un état serveur, mais ne suffit pas à
fusionner les insertions concurrentes. Une boucle à tick fixe et le lissage répondent à
des besoins de simulation et d'affichage, pas à la structure d'un document collaboratif.

## Consequences
Les répliques convergent malgré des réceptions dans des ordres différents et malgré les
renvois en double. Les paquets malformés sont entièrement validés avant d'être appliqués.
Les lots groupent les éditions d'une saisie pour éviter un message réseau par caractère.

Les positions et les tombstones consomment plus de mémoire et de bande passante que des
offsets seuls. Les tombstones ne sont pas purgés : une collecte sûre demanderait de connaître
les opérations encore susceptibles d'arriver. Le modèle fourni utilise un tableau et convient
à une démonstration ; les très grands documents demanderaient une structure indexée.

L'état reste en mémoire du serveur : un redémarrage ne constitue pas une sauvegarde durable.
Les éditions non confirmées pendant une coupure sont resynchronisées à la reconnexion ; ce TP
n'implémente pas une file hors-ligne durable. La diffusion entre plusieurs instances relève
du TP7. L'éditeur reste en texte brut.

## Validation

- `npm run scenario` : deux répliques convergent avec la stratégie active.
- `npm run scenario -- --naif` : le comportement initial diverge (sortie 1 attendue).
- `npm run test:tp6` : 16 vérifications, dont concurrence réelle via Socket.IO, doublons,
  suppression avant insertion, Unicode, validation atomique et snapshot tardif.
- `npm run test:tp5` : les 16 vérifications de présence et de reconnexion passent toujours.
- Vérification dans deux onglets : insertions concurrentes `X` et `Y` depuis `AB`, résultat
  identique `AYXB` dans Alice et Bob, document serveur identique.
