# ADR-1 : technique de push

## Statut
Accepté

## Contexte
L'editeur collaboratif possede un flux principal bidirectionnel : les clients envoient leurs
operations d'edition au serveur, qui les diffuse ensuite aux autres utilisateurs. Un flux
secondaire permet egalement de consulter l'historique des operations en lecture seule.

## Options envisagees
- Long-polling
- Server-Sent Events (SSE)
- WebSocket
- WebRTC

## Decision
Socket.IO sur WebSocket est retenu pour le flux principal, car l'edition necessite une
communication bidirectionnelle, des rooms par document, des accuses de reception et une
reconnexion automatique. SSE reste utilise pour diffuser l'historique des operations du serveur
vers les clients avec un mecanisme de rattrapage base sur `Last-Event-ID`.

## Pourquoi pas WebRTC pour le flux principal
Le serveur doit controler, ordonner et conserver les operations, ce qui rend une communication
principalement pair-a-pair inadaptee.

## Consequences
SSE offre un flux simple et rattrapable en lecture seule, mais ne permet pas aux clients d'envoyer
leurs modifications. Socket.IO se charge du flux bidirectionnel : les rooms `doc:<id>` isolent
les documents, les acks confirment le traitement des operations et le client se reconnecte
automatiquement.

## Preuve du rattrapage SSE

![Test Last-Event-ID](../captures/tp2-sse-rattrapage.png)
