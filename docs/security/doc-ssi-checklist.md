# Checklist — documentation SSI livrée

6 octobre 2026. Cases correspondant aux fichiers réellement présents, pas à une déclaration d'absence de risque.

- [x] Contexte et biens essentiels : contexte.md, BE1–BE4 et ER1–ER4.
- [x] Threat model du service réel : threat-model.md, DFD, frontières, STRIDE et H reliées BE/ER/contrôles.
- [x] Pipeline documenté : quatre workflows, cinq familles, seuils explicites, procédure en cas d'échec (README.md).
- [x] ADR sécurité : SEC-1 correctif de conception ; SEC-2 critères de priorisation, distincts des ADR temps réel.
- [x] Rapport d'audit : cinq findings, sources, preuves, CWE, sévérité, classement et recommandations.
- [x] Plan de remédiation conditionnel : fourni, actions affectées/datées, états honnêtes.
- [x] Registre : traitements réels, finalités, bases envisagées, données, destinataires et durées actuelles/proposées distinguées.
- [x] Points de conformité ouverts : registre et R-03/R-04/R-07. Aucune affirmation de conformité RGPD/NIS d'un service non défini.
- [x] Tests et rapports locaux avant/après conservés : evidence/.
- [x] Runs GitHub exécutés et findings Security vérifiés par API et lecture dans le navigateur connecté : preuves-ci.md et captures evidence/github/.
- [x] Captures de vrais runs vert/rouge pour backup : evidence/github/, horodatages visibles et source officielle conservée.
- [ ] Validation chronométrée de la soutenance commune et entraînement Q&A : à faire avec l'étudiant.

Documents manquants externes, explicitement non faits : contrat d'hébergement/IdP, accord de sous-traitance, procédure d'incident de production, analyse d'applicabilité NIS2. Motif : projet pédagogique local, aucune organisation/service de production identifié. Les actions avant ouverture sont dans le plan ; ces absences ne sont pas masquées.
