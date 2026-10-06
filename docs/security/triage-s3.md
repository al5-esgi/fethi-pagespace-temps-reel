# Triage TP3 — SAST et secrets

6 octobre 2026. Verdicts liés au projet réel, sans reprendre les injections SQL de Juice Shop.

| Finding, fichier et ligne avant | Règle/source | CWE / sévérité | STRIDE | Verdict et action |
|---|---|---|---|---|
| Clé JWT littérale, `src/realtime/security-helpers.ts:49` (`cdc7fec`) | Semgrep pagespace-hardcoded-jwt-secret | CWE-798 / haute | S-02 | Vrai positif : signature falsifiable avec une valeur connue. Clé générée/externe, rejet de l'ancienne clé, issuer/audience/exp imposés |
| Même clé dans le commit `09f2968acf2af773b25f46d74748b05d92c3a962` | Gitleaks pagespace-jwt-literal | CWE-798 / haute | S-02 | Vrai positif historique, pas un faux positif. Valeur invalidée. Seule l'empreinte historique exacte est acceptée et commentée dans .gitleaksignore ; une nouvelle occurrence bloque |
| Lectures REST sans appartenance, `src/rest.ts` handlers docs/history/snapshot au commit `cdc7fec` | Revue S-01 et reproduction HTTP | CWE-862/CWE-639 / haute | S-01 | Vrai positif : 200 anonyme sur le brief. Chargement readAccessibleDocument commun, 401/403/200 vérifiés ; règle SAST empêche le retour au chargement direct dans rest.ts |

Le Semgrep historique exécuté avec les règles ciblées remonte la clé ; il ne prouve pas seul l'absence d'ACL. La troisième ligne vient d'une revue et d'une mesure : ne pas attribuer à un scanner une preuve qu'il n'a pas produite. Les fichiers sources cités avant sont accessibles avec `git show cdc7fec:<chemin>`.

Les rapports `evidence/before/semgrep.sarif` et `gitleaks.json` conservent les preuves (valeur Gitleaks masquée). Les règles de crypto faible existent bien mais ne déclenchent aucun finding sur le code actuel : absence de SQL ou de hash de mot de passe faible dans cet éditeur.

La régression synthétique de `npm run security:regression` permet de tester les deux scanners sans utiliser de vrai secret. Le run rouge GitHub et les deux findings Security sont réellement exécutés et référencés dans preuves-ci.md ; captures authentiques dans evidence/github/.
