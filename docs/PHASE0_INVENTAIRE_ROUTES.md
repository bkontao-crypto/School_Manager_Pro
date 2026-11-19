# Phase 0 — Inventaire des routes (17/11/2026)

Source : lecture de `backend/src/modules/*.js`, `backend/src/index.js`, `backend/src/utils/resource.js`, `backend/src/utils/permissions.js`. Aucune requête exécutée.

## Chiffres
- Routes déclarées littéralement : **100**
- Routes générées par `makeResource` (15 modules) : **32** (15 × `GET /` et `POST /`, plus `GET /export.csv` pour 2 modules : grades, payments)
- Total : **132** points d'accès.

**Correction** : le chiffre de 76 routes indiqué dans `PHASE0_INVENTAIRE.md` était incomplet. Le total exact est celui ci-dessus.

## Garde-fous communs
- Montage `scoped` : `requireTenant`, puis `gateRead(module)` pour les lectures (`GET`) des modules listés, sauf indication contraire.
- Écritures des modules génériques : `requireWrite(module)` (niveau `write` requis, admin toujours autorisé).
- Aucun `PUT`/`PATCH` sur les 15 modules génériques : **aucune modification possible via l'API** (voir constats).
- Suppressions : seulement `periods /:id` et `timetable /:id`.

## Modules génériques
| Module | Méthode | Chemin | Garde |
|---|---|---|---|
| attendances | GET | / | gateRead('attendances') |
| attendances | POST | / | requireWrite('attendances') |
| canteen | GET | / | gateRead('canteen') |
| canteen | POST | / | requireWrite('canteen') |
| classes | GET | / | gateRead('classes') |
| classes | POST | / | requireWrite('classes') |
| documents | GET | / | gateRead('documents') |
| documents | POST | / | requireWrite('documents') |
| grades | GET | / | gateRead('grades') |
| grades | POST | / | requireWrite('grades') |
| hr | GET | / | gateRead('hr') |
| hr | POST | / | requireWrite('hr') |
| library | GET | / | gateRead('library') |
| library | POST | / | requireWrite('library') |
| messages | GET | / | gateRead('messages') |
| messages | POST | / | requireWrite('messages') |
| notifications | GET | / | gateRead('notifications') |
| notifications | POST | / | requireWrite('notifications') |
| payments | GET | / | gateRead('payments') |
| payments | POST | / | requireWrite('payments') |
| periods | GET | / | gateRead('periods') |
| periods | POST | / | requireWrite('periods') |
| stocks | GET | / | gateRead('stocks') |
| stocks | POST | / | requireWrite('stocks') |
| teachers | GET | / | gateRead('teachers') |
| teachers | POST | / | requireWrite('teachers') |
| timetable | GET | / | gateRead('timetable') |
| timetable | POST | / | requireWrite('timetable') |
| transport | GET | / | gateRead('transport') |
| transport | POST | / | requireWrite('transport') |
| grades | GET | /export.csv | gateRead('grades') |
| payments | GET | /export.csv | gateRead('payments') |

## Routes déclarées dans les autres modules
| Module | Méthode | Chemin |
|---|---|---|
| auth | POST | /login |
| auth | GET | /me |
| auth | POST | /password |
| auth | POST | /forgot |
| auth | POST | /reset |
| broadcasts | GET | /channels |
| broadcasts | GET | /preview |
| broadcasts | GET | / |
| broadcasts | POST | / |
| broadcasts | GET | /unpaid |
| broadcasts | POST | /unpaid |
| broadcasts | GET | /settings |
| broadcasts | PUT | /settings |
| identity | GET | / |
| identity | GET | /logo |
| identity | PUT | /logo |
| identity | DELETE | /logo |
| identity | PUT | /text |
| identity | DELETE | / |
| identity | GET | / |
| identity | GET | /logo |
| parents | POST | /:id/account |
| parents | PUT | /:id/preferences |
| parents | DELETE | /:id/account |
| payments | GET | /:id/receipt.pdf |
| periods | DELETE | /:id |
| platform | GET | /overview |
| platform | GET | /tenants |
| platform | GET | /tenants/:id |
| platform | POST | /tenants |
| platform | PUT | /tenants/:id |
| platform | POST | /tenants/:id/apply-plan |
| platform | POST | /tenants/:id/renew |
| platform | POST | /tenants/:id/suspend |
| platform | POST | /tenants/:id/reactivate |
| platform | PUT | /tenants/:id/admins/:userId/password |
| platform | PUT | /tenants/:id/admins/:userId/active |
| platform | GET | /plans |
| platform | POST | /plans |
| platform | PUT | /plans/:id |
| platform | GET | /invoices |
| platform | GET | /invoices.csv |
| platform | GET | /tenants.csv |
| platform | GET | /invoices/:id/pdf |
| platform | GET | /invoices/:id |
| platform | POST | /tenants/:id/invoices |
| platform | POST | /invoices/:id/pay |
| platform | POST | /invoices/:id/cancel |
| platform | POST | /invoices/:id/credit-note |
| platform | GET | /billing-settings |
| platform | PUT | /billing-settings |
| platform | GET | /audit |
| platformMail | GET | /mail |
| platformMail | GET | /mail/outbox |
| platformMail | POST | /mail/test |
| platformMail | POST | /mail/outbox/:id/retry |
| platformMail | POST | /reminders/run |
| platformMail | POST | /invoices/:id/send |
| portal | GET | /children |
| portal | GET | /children/:id |
| portal | GET | /children/:id/report-card.pdf |
| portal | GET | /children/:id/report-card |
| portal | GET | /children/:id/photo |
| portal | GET | /children/:id/payments/:paymentId/receipt.pdf |
| portal | GET | /children/:id/timetable |
| reports | GET | /overview |
| reports | GET | /payments.csv |
| settings | GET | / |
| settings | PUT | / |
| settings | GET | /banner |
| settings | GET | /banner/image |
| settings | PUT | /banner/image |
| settings | PUT | /banner/text |
| settings | DELETE | /banner |
| settings | GET | /subscription |
| settings | GET | /permissions |
| settings | PUT | /permissions |
| settings | DELETE | /permissions |
| settings | GET | /payment-providers |
| settings | POST | /subscription/invoices/:id/pay-online |
| settings | GET | / |
| settings | POST | / |
| settings | PUT | /:id |
| settings | PUT | /:id/password |
| stats | GET | /dashboard |
| students | GET | /export.csv |
| students | GET | / |
| students | POST | / |
| students | GET | /:id/profile |
| students | POST | /:id/parents |
| students | DELETE | /:id/parents/:parentId |
| students | GET | /:id/photo |
| students | PUT | /:id/photo |
| students | DELETE | /:id/photo |
| students | PUT | /:id/report-card/comment |
| students | GET | /:id/report-card.pdf |
| students | GET | /:id/report-card |
| students | PUT | /:id |
| students | DELETE | /:id |
| timetable | DELETE | /:id |

## Constats
- **Aucune route de modification (PUT/PATCH) pour 15 modules** : enseignants, classes, présences, notes, paiements, stocks, RH, bibliothèque, cantine, transport, documents, notifications, emploi du temps, périodes, messages. Le frontend n'en appelle aucune non plus. Écart avec §4.3 (CRUD complet) à traiter en Phase 1.
- **Pas d'archivage** ni de suppression logique génériques (`deleted_at` absent de `resource.js`) : §4.3 non couvert.
- Routes à garde spécifique vérifiées : `/stats/dashboard` (garde module ajoutée sur les paiements et l'audit, voir commit 5e86566), `/settings` et `/users` (admin), `/portal` (parent), `/platform*` (superadmin).
