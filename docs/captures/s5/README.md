# Captures du TP5 — présence et état partagé

Validation effectuée le 6 octobre 2026, avec Johnny et Alice sur `Notes de reunion`.
Les captures proviennent de l'éditeur réel, sur une instance de test locale au port 3100.

| Capture | Manipulation | Résultat visible |
|---|---|---|
| [snapshot-curseurs.jpg](snapshot-curseurs.jpg) | Alice sélectionne les caractères 57 à 121 sur deux lignes, puis Johnny ouvre un nouvel onglet. | Le texte courant, Alice, son curseur et sa sélection sont déjà présents grâce au snapshot du `join`, sans nouveau mouvement d'Alice. |
| [grace-reconnexion.jpg](grace-reconnexion.jpg) | Alice recharge son onglet et se reconnecte avant cinq secondes, avec le même identifiant de session. | Alice reste dans la liste et sa sélection est conservée. Le journal de Johnny affiche « Alice Bernard reconnecte sans depart ». Aucun événement `presence-left` n'a été reçu pour cette coupure. |
| [presence-left.jpg](presence-left.jpg) | L'onglet d'Alice est fermé pendant plus de cinq secondes. | Le journal annonce « Alice Bernard est parti » ; sa présence, son curseur et sa sélection disparaissent. Johnny reste connecté et le texte est conservé. |

## Reproduire les essais

Depuis le dossier `sujet-01-editeur` :

```bash
npm run dev
```

1. Ouvrir `http://localhost:3000/?profile=alice` et choisir `Notes de reunion`.
2. Écrire quelques lignes et sélectionner du texte.
3. Ouvrir ensuite `http://localhost:3000/?profile=demo-user` : la sélection d'Alice doit être visible immédiatement.
4. Recharger l'onglet d'Alice : Johnny ne doit pas voir de départ si la reconnexion prend moins de cinq secondes.
5. Fermer l'onglet d'Alice : après cinq secondes, son départ doit apparaître.

Pour simuler une micro-coupure de transport sans recharger la page, exécuter dans la console
du navigateur de l'onglet d'Alice :

```js
socket.io.engine.close()
```

Socket.IO reconnecte automatiquement et le snapshot restaure le texte et la sélection.

## Vérification automatisée

```bash
npm run typecheck
npm run test:tp5
```

Les **16 vérifications TP5** passent : JWT invalide refusé, snapshot initial, arrivée d'un membre,
signaux de curseur sans ajout à l'historique, arrivée tardive, recalage après insertion et suppression,
droits par document, absence de présence fantôme après un refus, positions bornées,
curseurs invalides ignorés, isolation des rooms, reconnexion courte sans faux départ,
départ unique après cinq secondes, retour après expiration et changement de room.

Les essais dans le navigateur confirment aussi la transmission d'un remplacement de texte
de même longueur, les sélections sur plusieurs lignes et la conservation de la sélection locale
lors d'une édition distante.

Johnny, Alice et Bob peuvent collaborer sur `Notes de reunion`. Seule Alice est autorisée sur
`Brief produit`. Ce sont des profils de démonstration ; l'écran ne constitue pas une connexion
avec mot de passe.

La convergence des éditions simultanées est traitée au TP6 ; les validations ci-dessus portent
sur les exigences du TP5.
