# TP6 — convergence des éditions concurrentes

Validation le 6 octobre 2026, sur une instance de test locale au port 3100.

## Captures

- `convergence-alice.jpg` : réplique d'Alice après fusion des deux insertions concurrentes.
- `convergence-bob.jpg` : réplique de Bob, avec exactement le même résultat `AYXB`.

Les deux éditeurs étaient ouverts sur `Notes de reunion`, avec le même texte initial `AB`.
Deux connexions de test authentifiées, Alice et Bob, ont chargé ce même snapshot, préparé
respectivement `X` et `Y` à la position 1 puis envoyé leurs lots CRDT concurremment.
Les deux navigateurs ont reçu les opérations et affiché le même texte, sans perdre de lettre.
L'ordre `AXYB` est également un résultat valide : les positions choisies sont denses et
aléatoires, mais l'ordre final est identique pour toutes les répliques d'une même exécution.

## Reproduire

Depuis `sujet-01-editeur` :

```bash
npm run scenario
npm run test:tp6
npm run test:tp5
npm run typecheck
```

Les tests TP6 et TP5 passent chacun leurs 16 vérifications.
Le scénario de concurrence utilise automatiquement le CRDT branché dans l'éditeur.
Pour montrer le défaut initial :

```bash
npm run scenario -- --naif
```

Cette dernière commande doit afficher `DIVERGE` et terminer avec le code 1.

Pour essayer l'interface : `npm run dev`, puis ouvrir
`http://localhost:3000/?profile=alice` et `http://localhost:3000/?profile=bob`.
Choisir `Notes de reunion` dans les deux et modifier le texte.
Le test `test:tp6` reproduit la concurrence de manière contrôlée, sans dépendre de la vitesse
de frappe ou du délai réseau entre deux onglets manipulés à la main.
