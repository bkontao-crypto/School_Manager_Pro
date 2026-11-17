# Phase 0 — Matrice des permissions (17/11/2026)

Source : `backend/src/utils/permissions.js` (valeurs par défaut, `DEFAULT_WRITE`, `DEFAULT_READ_ONLY_ROLES`), `backend/src/index.js` (montages `gateRead`), `backend/src/modules/stats.js`, `settings.js`, `portal.js`.
Niveaux : **W** écriture (inclut lecture) · **R** lecture · **—** aucun accès.
Valeurs **par défaut** : un établissement peut les modifier (table `role_permissions`, sauf le rôle admin). Calcul fait à la main depuis le code, non exécuté.

| Module | teacher | accountant | staff | user | admin | parent |
|---|---|---|---|---|---|---|
| students | R | R | R | R | W | — |
| classes | R | R | R | R | W | — |
| teachers | R | R | R | R | W | — |
| timetable | R | R | R | R | W | — |
| grades | W | R | R | R | W | — |
| attendances | W | R | R | R | W | — |
| payments | **R** | W | **R** | **R** | W | — |
| messages | W | W | W | W | W | — |
| documents | W | R | R | R | W | — |
| library | R | R | R | R | W | — |
| canteen | R | R | R | R | W | — |
| transport | R | R | R | R | W | — |
| hr | **R** | **R** | **R** | **R** | W | — |
| stocks | R | R | R | R | W | — |
| notifications | R | R | R | R | W | — |
| reports | — | R | — | — | W | — |
| periods | R | R | R | R | W | — |
| **stats/dashboard** (sans garde) | **tout** | **tout** | **tout** | **tout** | tout | bloqué |
| settings, users | — | — | — | — | W | — (sauf GET settings) |
| portal | — | — | — | — | — | W (ses enfants) |

Les colonnes ci-dessus donnent la lecture par défaut. Les modèles de lecture pour les rôles `staff` et `user` sont identiques à `teacher` dans le code, sauf pour les écritures.

## Anomalies confirmées par lecture du code (à tester en Phase 1)
- **P1 — `/stats/dashboard` sans garde** (`stats.js`) : renvoie aux rôles non autorisés les paiements nominatifs (nom de l'élève, montant, type de frais, statut), les recettes par mois et le journal d'audit avec les noms des utilisateurs. Aucun `requireRole` ni `gateRead`. (ordonnance §4.2)
- **P1 — Paiements lisibles par défaut** (`payments`, lecture `R` pour teacher, staff, user). Contraire à §4.2 : « ne pas exposer les paiements à un profil non autorisé ».
- **P1 — RH lisibles par défaut** (`hr`, lecture `R` pour tous les rôles du personnel). Contraire à §4.2 : « ne pas exposer les informations RH ».
- **P1 — Messagerie** : lecture ouverte à tout l'établissement (voir `PHASE0_INVENTAIRE.md`). Corrigée en partie par la migration 026 (participants), la route reste à adapter.

## Non vérifié
- Le comportement réel de chaque combinaison (tests par rôle) : impossible sans dépendances.
- Les surcharges éventuelles stockées par les établissements dans `role_permissions` : non inspectées.
