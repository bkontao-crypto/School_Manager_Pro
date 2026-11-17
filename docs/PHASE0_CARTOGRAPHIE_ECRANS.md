# Phase 0 — Cartographie des écrans (17/11/2026)

Source : `frontend/index.html` (navigation) et `frontend/app.js` (registre `MODULES`, ligne 478). Lecture du code, aucun test.

## Écrans gérés par le registre générique `MODULES`
Ces écrans partagent le même modèle de liste, de formulaire et d'écriture.

| Clé | Titre | API | Rôles en écriture (`writeRoles`) |
|---|---|---|---|
| students | Élèves | /api/students | admin |
| teachers | Enseignants | /api/teachers | admin |
| classes | Classes | /api/classes | admin |
| grades | Notes | /api/grades | admin, teacher |
| attendances | Présences | /api/attendances | admin, teacher |
| payments | Paiements | /api/payments | admin, accountant |
| library | Bibliothèque | /api/library | admin |
| canteen | Cantine | /api/canteen | admin |
| transport | Transport | /api/transport | admin |
| notifications | Notifications | /api/notifications | admin |
| hr | Personnel (RH) | /api/hr | admin |
| documents | Documents | /api/documents | admin, teacher |
| stocks | Stocks | /api/stocks | admin |
| messages | Conversations | /api/messages/conversations | **aucune restriction de rôle** (`null`) |

## Entrées de navigation (`data-module` dans index.html)
dashboard (Tableau de bord), portal (Mes enfants), students, teachers, classes, timetable (Emploi du temps), grades, attendances, payments, library, canteen, transport, messages, notifications, hr, documents, stocks, broadcasts (annonces), reports (rapports), settings (paramètres).

Les entrées dashboard, portal, timetable, broadcasts, reports et settings ont leur propre logique, hors registre `MODULES`. Elles ne sont pas détaillées ici.

## Constats (lecture seule)
- **Messagerie** : aucune restriction de rôle côté écriture dans le registre. Côté serveur, la lecture n'est pas restreinte aux participants (voir `PHASE0_INVENTAIRE.md`, P1).
- **Dashboard** : entrée de navigation sans registre ; la garde serveur de `/stats/dashboard` reste à confirmer.
- Les rôles `teacher` et `accountant` sont donnés directement dans le registre, pas via une matrice de permissions centralisée : à reprendre dans la matrice PH0-05.
