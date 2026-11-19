# Phase 0 — Inventaire initial (17/11/2026)

Branche : `phase0-audit-initial` (base : `retrait-audit-cookies-traceurs-v2` @ e80e46a). Aucun code métier modifié.

## 1. Montage de l'API (`backend/src/index.js`, ordre réel)
1. `rateLimit` par minute (API).
2. `/identity` public (nom, slogan, logo de connexion).
3. `authenticate` puis `/auth` (login public, `/me` protégé).
4. `requireAuth` + `requireActiveAccount` : tout ce qui suit exige un jeton valide.
5. `/platform` : `requireSuperAdmin` (établissements, packs, licences, quotas).
6. Routeur `scoped` : `requireTenant` (établissement issu du jeton), cloisonnement du rôle `parent` (seuls `/portal` et `GET /settings`), quotas sur création d'élèves et d'utilisateurs, puis un montage par module.
   - `gateRead(module)` contrôle la lecture par module : broadcasts, students, classes, teachers, attendances, grades, payments, messages, documents, stocks, notifications, hr, library, canteen, transport, periods, timetable, reports.
   - Sans `gateRead` : `/portal`, `/parents`, `/stats`, `/settings`, `/users`.

## 2. Routes
- 132 points d'accès : 100 routes déclarées littéralement + 32 générées par `makeResource` (détail dans `PHASE0_INVENTAIRE_ROUTES.md`). Correction : le chiffre de 76 précédemment indiqué était incomplet.
- Répartition (routes déclarées) : platform 26 · settings 17 · students 14 · identity 8 · broadcasts 8 · portal 7 · platformMail 6 · auth 5 · parents 3 · reports 2 · autres 1 à 1.

## 3. Migrations (`database/migrations`, 25 fichiers, ordre 001 → 025)
001 initial tenants/users · 002 students/classes · 003 parents · 004 teachers · 005 attendances · 006 grades/payments · 007 messages/documents · 008 stocks/notifications · 009 hr/staff · 010 library/canteen · 011 transport · 012 student individual records · 013 hardening · 014 timetable · 015 academic periods · 016 tenant banners · 017 platform superadmin · 018 billing identity · 019 mail/reminders/credit notes · 020 student photos · 021 role permissions · 022 parent portal · 023 notifications channels · 024 unpaid reminders · 025 mail attachments.
- **Test de migration** : les 25 fichiers appliqués dans l'ordre sur une base PostgreSQL 16 vide (`smp_test`) : 0 erreur, 42 tables créées.
- Détail par migration (colonnes, index, clés, verrouillage) : **non fait**.

## 4. Tests (état initial, non validé)
| Fichier | Résultat |
|---|---|
| tests/unit/image.test.js | 7/7 réussis |
| tests/unit/smtp.test.js | 4/4 réussis |
| tests/unit/pdf.test.js | 4/4 réussis |
| tests/unit/core.test.js | **échec** : module `dotenv` absent (installation npm impossible : registre refusé par le proxy) |
| tests/integration/api.test.js | **non exécuté** (PostgreSQL de test requis) |

`npm ci` est refusé par le proxy de cette session (registre npm non autorisé pour ce compte) : les dépendances ne sont pas installées, donc le serveur et les tests d'intégration ne peuvent pas tourner ici.

## 5. Anomalies classées (préliminaires, à confirmer en Phase 1)
- **P1 — Messagerie (ordonnance §4.1), confirmé par lecture du code** : `messages.js` s'appuie sur `makeResource` dont le seul cloisonnement est `tenant_id` (`utils/resource.js`). Il n'existe ni table de participants ni contrôle de participation : tout utilisateur connecté de l'établissement peut lister les conversations (`GET /messages/conversations`) et lire les messages de n'importe quelle conversation (`GET /messages/messages?conversation_id=`). Non reproduit par un test HTTP (serveur non démarrable dans cette session).
- **P1 — Tableau de bord (ordonnance §4.2)** : `GET /stats/dashboard` n'a ni `gateRead` ni contrôle de rôle visible dans `stats.js`. À confirmer et à tester pour chaque rôle.
- **P2 — Environnement** : test `core` en échec faute de `dotenv` ; intégration non exécutée.

## 6. Non réalisé dans cette phase
- Cartographie des écrans frontend (PH0-02).
- Matrice complète rôles × permissions × routes (PH0-05, partielle).
- Inventaire détaillé des migrations (PH0-04, partiel).
- Version/build de référence du site (PH0-07) : à produire après validation de ce rapport.
