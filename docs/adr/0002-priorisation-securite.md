# SEC-2 — Priorisation et risque résiduel

Accepté le 6 octobre 2026. Distinct de l'ADR temps réel 2 (CRDT).

## Contexte

Une sévérité technique ne décrit ni la valeur du document ni l'exposition du service. Il faut savoir expliquer pourquoi F-01 précède une alerte de scanner, sans casser concurrence et reprise.

## Critères réutilisables

1. **Impact métier** : BE/ER, gravité 1–4, confidentialité/intégrité/disponibilité, personnes concernées.
2. **Exposition** : entrée anonyme/public, authentifiée, réseau interne ou accès privilégié.
3. **Exploitabilité** : preuve reproductible, préconditions et fonctionnalité vulnérable réellement activée. Package affecté ne signifie pas scénario démontré.
4. **Priorité** : P0 = identité compromise/fuite prouvée, avant ouverture ; P1 = faille haute exposée ou réduction peu coûteuse d'un risque significatif ; P2 = risque modéré/interne avec mesure compensatoire et échéance ; P3 = information/amélioration.
5. **Décision** : corriger, accepter temporairement, faux positif démontré. Responsable, échéance, preuve et risque restant obligatoires ; exception ciblée avec revue.
6. **Effort et régression** départagent la même priorité. Un faible effort ne justifie pas de repousser un P0.

HIGH/CRITICAL en CI bloque même si l'exploitation semble peu probable. Toute exception exige une trace ciblée revue et datée. OSV de sévérité inconnue bloque par prudence ; un rapport absent/invalide bloque également. Comparer identifiants/versions de npm et OSV, ne pas additionner leurs compteurs.

## Application et cas nouveau

F-01/F-02 P0 : fuite et clé connue, correction immédiate. F-04 P1 : dépendances corrigibles, montée majeure de static vérifiée avec les scénarios. F-03 P1 : durcissement simple. F-05 P2 local/P1 avant production : quotas/purge à concevoir sans détruire les tombstones de reconnexion.

Une future dépendance CRITICAL de test reste bloquante, puis on vérifie ses entrées et le risque sur le runner avant une exception ciblée. Une ACL anonyme de CVSS inférieur à 7 reste P0 si elle divulgue le brief essentiel. Les critères sont donc applicables à un autre finding.

## Alternatives rejetées

CVSS seul ignore le métier ; effort seul laisse les fuites ; tout ignorer pour obtenir du vert supprime la valeur des contrôles ; traiter chaque information avant les P0 retarde la réduction principale.

## Conséquences

Les 31 alertes système LOW/MEDIUM de l'image mesurée restent dans le rapport sous le seuil HIGH/CRITICAL, avec revue des mises à jour. L'ancienne clé invalidée a une seule exception Gitleaks historique par empreinte. Vert signifie seuil respecté, pas absence de risque.
