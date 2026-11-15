# Architecture générale — SCHOOL MANAGER PRO

## Principes
- **Multi-tenant** : isolation logique stricte des données par `tenant_id` (établissement ou groupe).
- **API modulaire** : chaque domaine métier = module backend indépendant (élèves, finances, RH, LMS, messagerie, etc.).
- **Deux niveaux d'autorisation** :
  1. Superadmin contrôle les fonctionnalités autorisées par licence/contrat.
  2. Administrateur local attribue les droits aux utilisateurs dans les limites du contrat.
- **Sécurité** : JWT, RBAC fin, journalisation des actions sensibles, pas de suppression physique par défaut.
- **PWA** : installable, mode hors-ligne partiel (à définir progressivement).

## Stack technique
- Backend : Node.js (Express ou Fastify) + modules
- Base : PostgreSQL (schéma unique avec tenant_id ou schémas séparés — décision à valider)
- Frontend : HTML5 / CSS3 / JavaScript vanilla ou léger (pas de framework lourd imposé)
- Auth : JWT + refresh + sessions sécurisées
- Fichiers : stockage local sécurisé (hors web root) pour documents

## Isolation multi-tenant
- Toutes les requêtes métier filtrées par `tenant_id`.
- Superadmin a un contexte séparé.
- Aucune communication inter-tenants par défaut.

## Modules principaux (liste non exhaustive)
1. Superadmin / Licences / Packs
2. Utilisateurs / Profils / Permissions
3. Élèves / Inscriptions / Parents
4. Classes / Emplois du temps
5. Enseignants / Personnel
6. Présences / Absences
7. Examens / Notes / Bulletins
8. Finances / Paiements
9. Stock / Logistique
10. Messagerie interne
11. LMS / Cours en ligne
12. RH / Bibliothèque / Cantine
13. Notifications
14. Statistiques / IA (préparée, désactivable)

## Prochaines décisions techniques
- Choix exact du framework Node (Express recommandé pour simplicité).
- Stratégie de multi-tenancy (shared schema + tenant_id vs schema per tenant).
- Gestion des fichiers et documents.

## État de l'implémentation (v2.5.0)
- **Multi-établissements** : schéma partagé avec `tenant_id NOT NULL` et clés étrangères composites `(tenant_id, id)` ; l'établissement provient du jeton signé (le superadmin peut choisir via `x-tenant-id`). Décision retenue : schéma partagé.
- **Authentification** : mot de passe haché en scrypt, jeton JWT HS256 (`backend/src/utils/jwt.js`, sans dépendance), expiration `JWT_EXPIRES_IN` (8 h par défaut). Pas encore de jeton de rafraîchissement.
- **Couches** : `config` → `utils` (db, jwt, password, validate, http, audit, resource) → `middleware` (auth, security) → `modules` (un fichier par domaine). `makeResource` fournit liste paginée et création validée aux modules simples.
- **Erreurs** : `errorHandler` central ; les codes PostgreSQL (23505, 23503, 23514, 23502, 22P02) sont traduits en 409/422/400 sans détail interne.
- **Framework** : Express 4 (décision prise). Les erreurs asynchrones passent par `wrap()`.
- **Audit** : les actions sensibles écrivent dans `audit_logs` (au mieux : un échec d'écriture ne bloque pas la requête).

## E-mails et rappels (v2.11.0)
- `utils/smtp.js` (client SMTP sans dépendance) → `utils/mailer.js` (`deliver` : journalise dans `mail_outbox`, ne lève jamais d'exception) → utilisé par `modules/platformMail.js` (superadmin), `modules/auth.js` (mot de passe oublié) et `utils/reminders.js` (rappels, planificateur lancé dans `index.js`, uniquement hors tests).
- `utils/onlinePayments.js` : fournisseurs déclarés mais **désactivés en dur** (paiement en ligne indisponible).
- Sauvegarde : `scripts/backup.js`, `scripts/restore.js`.

## Portail parent (v2.14.0)
`modules/portal.js` (rôle `parent` exigé) revérifie à chaque requête le chemin compte → `parent_accounts` → `student_parents` → élève ; `modules/parents.js` (administrateur) crée/supprime les accès. Un garde dans `index.js` limite un compte parent à `/api/portal` et à la lecture de `/api/settings`. Lectures partagées avec l'application : `utils/studentData.js`.

## Permissions (v2.13.0)
- `utils/permissions.js` : matrice par défaut (historique) + dérogations de `role_permissions`. `gateRead(module)` est monté devant chaque module dans `index.js` (toute requête GET exige « lecture ») ; `requireWrite(module)` remplace `requireRole` sur les actions de modification (et `makeResource({ module })`). `admin` a toujours « écriture ». Comptes, paramètres, identité, abonnement : `requireRole('admin')` inchangé.
