# Registre des traitements — Pagespace

6 octobre 2026. Registre descriptif de la démonstration locale réelle, adapté du gabarit du cours. Les profils sont fictifs ; le contenu saisi pourrait toutefois devenir personnel. Les durées **actuelles** et les durées **proposées** sont distinguées. Ce document ne certifie pas la conformité d'un futur service.

## Responsable et périmètre

Projet pédagogique géré par l'étudiant mainteneur de `al5-esgi/fethi-pagespace-temps-reel`. Contact de projet : compte mainteneur du dépôt (aucune adresse email inventée). DPO : aucun désigné pour ce prototype ; le responsable d'un service réel devra déterminer ses obligations. Usage limité au poste local, aucune liste de clients, email, mot de passe ou paiement.

## Traitements réels

| Traitement | Finalité | Base légale envisagée et limite | Personnes / données | Destinataires et supports | Durée actuelle et objectif |
|---|---|---|---|---|---|
| T-01 Session et accès | Démontrer l'identité d'un profil, l'ACL et la reconnexion | Intérêt légitime pédagogique, limité à profils fictifs et participation informée ; balance et information nécessaires si utilisateurs réels | Participants locaux ; sub, profil/nom fictif, JWT, clientId, profil mémorisé | Navigateur du participant, serveurs A/B ; JWT en mémoire, identifiants sessionStorage, profils dans code | JWT 1 h ; socket/SSE fermés à exp ; sessionStorage jusqu'à fermeture de l'onglet ; profils fictifs tant que code conservé |
| T-02 Documents et historique | Écriture collaborative, convergence et reprise | Intérêt légitime pédagogique pour textes de test ; future base contrat seulement si service réel le justifie, à valider | Coéditeurs ; titres/texte, ownerId, collaborateurs, auteur et horodatage des opérations, positions CRDT/tombstones | Collaborateurs autorisés via REST/SSE/rooms, mainteneur local ; mémoire ou Redis/AOF | Solo : jusqu'à arrêt ; cluster : persistant sans TTL/purge. **Durée réelle non limitée** (F-05). Objectif proposé : fin de séance + 7 jours de récupération, puis effacement/compactage testé avant usage réel |
| T-03 Présence et curseurs | Voir les collaborateurs et positions de sélection | Intérêt légitime à collaborer, données minimales ; pas de suivi secondaire | Coéditeurs ; presenceId, socketId interne, sub, nom/couleur, positions/sélections, ancres | Seule room autorisée, serveurs/Redis ; socketId non publié dans Member public | Grâce 5 s après disconnect détecté ; bail actif 15 s après crash, nettoyé par monitor ; aucune collecte d'historique de curseurs |
| T-04 Exploitation et validation | Santé, détection des pannes, preuves de soutenance | Intérêt légitime à maintenir le prototype ; pas de tracking commercial | Participants/admin local ; connexions et compteurs agrégés, IP/URL dans logs nginx/Docker, auteur Git et métadonnées CI ; tokens masqués dans scanners | Mainteneur ; Docker local ; GitHub pour sources/CI/rapports de démo | Métriques mémoire jusqu'à arrêt, logs Docker selon rotation ; artefacts CI 7 jours après publication ; fichiers de preuve Git conservés avec le dépôt, uniquement données fictives/techniques publiques |

### Mesures et destinataires complémentaires

Aucune donnée sensible nécessaire ; ne pas saisir de données de santé, financières ou secrets dans les documents de test. Les blocs/historiques héritent de l'ACL documentaire ; présence/curseurs isolés par room. API/SSE no-store, Origin/JWT, limites d'entrée, secret hors Git, conteneurs non root. Le SSE conserve les 100 derniers événements, pas une durée de 100 secondes.

Sous-traitants : aucun hébergeur d'application externe pour la démo. GitHub héberge le dépôt public et exécute les scans ; les scanners interrogent npm/OSV et les registres d'images avec noms/versions techniques. Ne pas y envoyer de contenus réels. Contrat art. 28, localisation, transferts hors UE et garanties d'un futur déploiement : à examiner avant usage réel, non validés ici.

## Points ouverts et minimisation

- R-03 : fixer et implémenter durée/purge/quota documentaire ; actuellement l'AOF n'efface pas automatiquement les données.
- R-04 : information et procédure d'accès/effacement ; pas d'interface dédiée aujourd'hui.
- R-07 : identifier responsable/contact réel, base légale, IdP/hébergeur, sous-traitance et transferts avant ouverture.
- Les profils fictifs ne justifient pas une collecte de vraies données. Les métriques publiques en mode local sont masquées en production.

Sources de méthode : [registre CNIL](https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement), [durées de conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees), [intérêt légitime](https://www.cnil.fr/fr/les-bases-legales/interet-legitime). La base et la durée dépendent du traitement réel ; elles ne se décrètent pas par copier-coller du modèle.
