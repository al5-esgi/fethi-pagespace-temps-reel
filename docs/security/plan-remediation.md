# Plan de remédiation

Plan produit volontairement pour soutenir le critère audit/ADR-2. Responsable de toutes les actions locales : mainteneur étudiant du dépôt. Échéances de travail proposées au 6 octobre 2026, pas engagements fictifs d'une organisation.

| ID | Action et priorité | Responsable | Échéance | Effort | Validation / état |
|---|---|---|---|---|---|
| R-01 | F-01 ACL REST/SSE et owner JWT — P0 | Mainteneur | 06/10/2026 | 1 séance | Fait, 401/403/200 et filtre SSE testés |
| R-02 | F-02 rotation/config JWT et démo interdite en production — P0 | Mainteneur | 06/10/2026 | 1 séance | Fait, ancien jeton rejeté, expiration WS et démarrage production testés |
| R-03 | F-05 quota, conservation, effacement et compactage sûr — P2 local/P1 production | Mainteneur | Conception 20/10/2026, avant ouverture réelle | 2–3 séances | Ouvert ; tests de retard/rejeu/suppression et registre mis à jour requis |
| R-04 | Journal d'audit protégé et traitement des demandes de droits — P2 | Mainteneur + futur responsable du service | Avant usage réel | 1–2 séances | Ouvert ; auteur/horodatage actuels ne suffisent pas à l'immutabilité |
| R-05 | F-03 CSP, headers et Origin — P1 | Mainteneur | 06/10/2026 | 1 séance | Fait, ZAP et navigateur ; styles inline à revoir 06/11/2026 |
| R-06 | F-04 dépendances, SBOM et image durcie — P1 | Mainteneur | 06/10/2026 | 1 séance | Fait localement, aucun HIGH/CRITICAL image ; suivi bases hebdomadaire |
| R-07 | Auth réelle, TLS, ACL/TLS Redis et contrat hébergeur — P1 production | Futur responsable du service avec mainteneur | Avant toute exposition publique | À estimer selon hébergeur/IdP | Bloque l'ouverture publique ; périmètre actuel local fictif |
| R-08 | Runs GitHub vert/rouge + finding Security + captures — soutenance | Mainteneur | 06/10/2026, refaire avant passage | 30 min | Fait : vrais runs et findings vérifiés, captures dans evidence/github/ |

Si une échéance glisse : réévaluer le périmètre/exposition, consigner raison et nouveau responsable/date. Aucun P0 ouvert ne peut être compensé par une belle présentation.
