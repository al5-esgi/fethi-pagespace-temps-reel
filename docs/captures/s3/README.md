# Captures du TP3

- `handshake-101.png` : handshake WebSocket authentifie, avec le statut `101`,
  `Sec-WebSocket-Key` et `Sec-WebSocket-Accept`.
- `refus-401.png` : connexion sans JWT refusee avec le statut `401`.
- `rate-limit-1008.png` : envoi de 50 messages en moins d'une seconde. Le seuil choisi est de
  20 messages par seconde et par connexion ; le serveur ferme la connexion avec le code `1008`.
