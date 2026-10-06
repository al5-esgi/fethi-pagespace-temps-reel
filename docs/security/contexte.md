# Contexte de sécurité — Pagespace

6 octobre 2026. Périmètre : éditeur réel `sujet-01-editeur`, dépôt `al5-esgi/fethi-pagespace-temps-reel`. Les méthodes des TP1–TP5 sont adaptées à Fastify, SSE, Socket.IO et Redis ; les vulnérabilités propres à Juice Shop ne sont pas recopiées.

## 1. Contexte métier

Des collaborateurs rédigent simultanément des documents. Chaque document possède un propriétaire et des collaborateurs ; une room `doc:<id>` transporte opérations CRDT, curseurs et présence. Deux instances partagent leur état via Redis derrière nginx. REST sert liste, texte, historique et snapshots ; SSE permet un rejeu limité. Le frontend utilise Socket.IO.

Les identités et textes fournis sont fictifs. Choisir Alice ne prouve pas son identité : le mode pédagogique reste local et est désactivé en production. Une authentification réelle et TLS sont requis avant toute ouverture publique.

## 2. Biens essentiels

| ID | Bien essentiel et valeur métier | Supports |
|---|---|---|
| BE1 | Confidentialité des documents/historiques : un brief réservé ne doit pas être divulgué | ACL, REST/SSE, mémoire, Redis/AOF |
| BE2 | Intégrité du texte et attribution : aucune édition perdue, dupliquée ou imputée à autrui | JWT, rooms, CRDT, tombstones, historique, Redis atomique |
| BE3 | Disponibilité de la rédaction et reprise après coupure | Socket.IO, snapshots, nginx, Redis, limites taille/débit |
| BE4 | Vie privée : limiter identifiants, présences, curseurs et traces | Profils fictifs, sessionStorage, JWT, états éphémères, métriques, CI |

## 3. Sources de risque

Visiteur anonyme, collaborateur curieux/malveillant, script automatisé, jeton volé, dépendance compromise, erreur de configuration, panne serveur/Redis. Le poste et le réseau Docker sont sous le contrôle de l'étudiant ; ce n'est pas une infrastructure de production multi-tenant.

## 4. Événements redoutés

| ID | Événement et impact | Biens | Gravité /4 et justification |
|---|---|---|---|
| ER1 | Lecture d'un brief réservé et divulgation des contributions : perte de confidentialité et confiance | BE1/BE4 | 4 : une fuite ne se répare pas par un redémarrage |
| ER2 | Identité usurpée ou opérations perdues : texte métier incorrect et attribution contestée | BE2 | 4 : donnée et confiance compromises |
| ER3 | Éditeur indisponible/divergent pendant la séance : rédaction interrompue | BE3 | 3 : réversible si les données sont récupérées |
| ER4 | Conservation indéfinie des textes/identifiants : exposition prolongée et suppression difficile | BE1/BE4 | 3 : durée non justifiée, problème de conformité |

## 5. Suivi

Mesures datées : `evidence/before/` et `evidence/after/`. Preuves GitHub : `preuves-ci.md` (distingue les runs réellement exécutés des workflows seulement écrits). Chaque ligne H du threat model est reliée à BE/ER, un correctif et un contrôle. Risques résiduels : audit, SEC-2 et plan de remédiation.
