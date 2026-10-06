# TP7 — deux instances, Redis et proxy

Validation locale le 6 octobre 2026. Les services Docker `app-a`, `app-b`, `redis` et `proxy`
sont démarrés et les deux applications sont saines.

## Lancer

Depuis `sujet-01-editeur` :

```bash
docker compose up --build -d --wait
npm run test:tp7
npm run s7:load
```

- Éditeur derrière nginx : `http://localhost:3010`.
- Instance A et métriques : `http://localhost:3101` et `http://localhost:3101/metrics`.
- Instance B et métriques : `http://localhost:3102` et `http://localhost:3102/metrics`.
- Santé : `/api/health`, avec le nom de l'instance et l'état Redis.

Le port 3010 évite de gêner l'éditeur local déjà lancé sur 3000. Redis reste uniquement sur
le réseau interne Docker. Pour arrêter : `docker compose stop`. Le volume Redis est conservé.

## Captures des deux éditeurs

- [instance-A.jpg](instance-A.jpg) : Alice sur `localhost:3101`, avec la sélection de Bob reçue
  depuis B, visible en vert dans le texte.
- [instance-B.jpg](instance-B.jpg) : Bob sur `localhost:3102`, avec le texte écrit sur A et les
  mêmes collaborateurs.

Les deux onglets utilisent `Notes de reunion`. Le test vérifie aussi les headers
`X-Editor-Instance` et les snapshots `instance: A/B`, pour confirmer la connexion à deux
serveurs distincts. Aucun message d'erreur n'a été observé dans les deux navigateurs.

Pour reproduire : ouvrir `http://localhost:3101/?profile=alice` puis
`http://localhost:3102/?profile=bob`, modifier le texte dans A et sélectionner du texte dans B.
Pour l'usage normal, passer par le proxy sur 3010.

## Relevé de charge réel

Source : [load-results.json](load-results.json). Les six fichiers `metrics-A/B-before/during/after.prom`
contiennent les relevés Prometheus bruts avant, pendant et après le test.

| Jauge | A avant | A pendant | A après | B avant | B pendant | B après |
|---|---:|---:|---:|---:|---:|---:|
| `ws_active_connections` | 0 | 50 | 0 | 0 | 50 | 0 |
| `ws_document_rooms` | 0 | 1 | 0 | 0 | 1 | 0 |
| `redis_connected` | 1 | 1 | 1 | 1 | 1 | 1 |

100 connexions sur 100 ont réussi. Le test impose une répartition 50/50 en contactant directement
les deux instances ; il vérifie ainsi leur charge et la diffusion entre elles. Avec `ip_hash`,
des clients du même ordinateur peuvent être dirigés vers la même instance par le proxy : cela
correspond à l'affinité par IP, et non à une erreur de répartition.

Le temps d'établissement mesuré côté client est de **62,80 ms en médiane** et **102,89 ms au
95e percentile**. Le cycle de connexion, join et déconnexion a pris **137,52 ms**, dans ce test
local ; ces chiffres ne constituent pas une mesure en conditions Internet.

Après la déconnexion massive, les connexions actives reviennent de 50 à 0 sur chaque instance,
et les rooms locales de 1 à 0. Aucun socket résiduel n'est observé ; les présences en délai
de grâce sont ensuite supprimées par le nettoyage partagé.

## Vérifications

`npm run test:tp7` couvre 15 cas :

1. Instances A/B distinctes et Redis connecté.
2. Document créé sur A immédiatement lisible sur B.
3. Snapshots avec les mêmes positions stables et les présences de toutes les instances.
4. Curseur et sélection de A reçus sur B.
5. Insertions concurrentes A/B : convergence et aucune lettre perdue.
6. Texte REST identique sur A et B.
7. Renvoi d'une opération sans doublon d'historique.
8. SSE et `Last-Event-ID` communs aux instances.
9. Arrivée tardive sur B avec les éditions de A déjà présentes.
10. Polling HTTP via le proxy sans erreur `Session ID unknown`.
11. Métriques exposées avec le bon label d'instance.
12. Reconnexion de A vers B avant cinq secondes, sans fausse sortie.
13. Départ unique après expiration du délai de grâce.
14. Autorisations par document conservées.
15. Positions CRDT non canoniques et Unicode invalide refusés sans modification du texte.

Les tests créent leurs propres documents de validation. Les 16 vérifications TP5 et les
16 vérifications TP6 passent toujours, ainsi que le typage et le scénario de convergence.
Un essai séparé confirme qu'un Redis configuré mais indisponible empêche le démarrage multi-instance.

L'ADR-3 reste proposée au TP7 : les essais de robustesse du TP8 permettront son acceptation.
