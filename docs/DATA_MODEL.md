# Proposition de modèle de données (haut niveau) — Phase 1

## Entités centrales

### Tenants & Commercial
- `tenants` (établissements / groupes)
- `licenses` (code, statut, dates, pack, quotas)
- `packs` (nom, modules autorisés, quotas)
- `contracts`

### Utilisateurs & Permissions
- `users` (rattachés à un tenant)
- `profiles` / `roles`
- `permissions` (module, action, scope)
- `user_permissions` (avec contraintes de classe, période, etc.)

### Académique
- `students` (matricule permanent)
- `parents` / `guardians` (relation many-to-many)
- `classes` / `levels` / `sections`
- `teachers`
- `subjects` / `programs`
- `timetables`
- `attendances`
- `evaluations` / `grades` / `report_cards`

### Financier
- `fees` / `payments` / `receipts` / `debts`

### Autres
- `messages` / `conversations`
- `documents`
- `notifications`
- `audit_logs`

## Règles métier clés à respecter dans le schéma
- Matricule élève permanent même en cas de changement de classe.
- Historisation des affectations (classes, enseignants, années scolaires).
- Soft delete uniquement.
- Traçabilité des actions sensibles.
- Quotas contrôlés par licence.

*Ce modèle sera détaillé et transformé en migrations PostgreSQL en Phase 3 après validation.*

## État du schéma (migrations 001-025)
- Toutes les tables métier portent `tenant_id NOT NULL` ; les liens entre tables sont des clés composites `(tenant_id, id)` : un enregistrement ne peut pas référencer une ligne d'un autre établissement.
- `students.deleted_at` : suppression logique ; le matricule reste réservé. 
- `payments` : statuts `paye`, `en_attente`, `annule` ; reçu `R-AAAA-NNNNNN` unique par établissement, numéroté par `tenant_counters`.
- `attendances` : unicité (élève, classe, date), la classe absente étant comptée comme une valeur unique.
- Contrôles `CHECK` : rôles, statuts, notes 0-20, montants > 0 (certains créés `NOT VALID` : ils s'appliquent aux nouvelles lignes ; lancer `VALIDATE CONSTRAINT` après nettoyage de données anciennes).
- `timetable_slots` (014) : classe, enseignant facultatif, jour 1-7, heures (fin > début), salle ; chevauchements refusés par l'API.
- `subscription_invoices`, `platform_counters`, `tenant_identity`, `platform_identity` (018) : factures d'abonnement numérotées (statut pending / paid / cancelled), compteur de plateforme, identité (nom, slogan, logo `bytea` ≤ 512 Ko) par établissement et pour la plateforme.
- 019 : `mail_outbox` (journal des e-mails : statut, tentatives, erreur), `notification_log` (rappels déjà envoyés, clé `(kind, ref)`), `password_resets` (empreinte SHA-256 du jeton, expiration, usage), `platform_settings` (TVA par défaut, mentions légales, modalités de paiement), `report_card_comments` (appréciation ≤ 600 car. et décision du conseil par élève et période, clé `(tenant_id, student_id, period_key)`). `subscription_invoices` : `document_type` (invoice / credit_note), `credit_for`, `subtotal`, `discount_amount`, `tax_rate`, `tax_amount`, `last_sent_at`, statut `issued` pour les avoirs.
- `mail_outbox.attachment_name / invoice_id` (025) : nom de la pièce jointe et facture à régénérer lors d'un nouvel essai (le fichier lui-même n'est pas stocké).
- `notification_settings.unpaid_channels / unpaid_after_days` (024) : rappels d'impayés automatiques ; `broadcasts.audience_type` accepte `unpaid`.
- `notify_outbox`, `broadcasts`, `notification_settings`, colonnes `parents.notify_*` (023) : journal SMS/WhatsApp, historique des messages groupés, canaux de l'alerte d'absence, préférences de chaque responsable.
- `parent_accounts` (022) : lie un compte (`users.role = 'parent'`) à UNE fiche `parents` ; clé `(tenant_id, parent_id)`, `user_id` unique ; supprimé avec le compte ou la fiche.
- `role_permissions` (021) : dérogations à la matrice par défaut, clé `(tenant_id, role, module)`, niveau none / read / write ; rôle `admin` non stocké (toujours tous les droits).
- `student_photos` (020) : photo d'élève (`bytea` ≤ 1 Mo, type, dimensions), clé `(tenant_id, student_id)` avec clé étrangère composite vers `students`.
- `plans` (017) : packs (quotas élèves / utilisateurs, prix) ; `tenants` reçoit pack, contact, licence (début / fin), quotas, suspension (017). La table `licenses` de la migration 001 reste inutilisée.
- `tenant_banners` (016) : affiche d'accueil de l'établissement (image `bytea` ≤ 2 Mo, dimensions, titre / sous-titre) ; aucune ligne = affiche par défaut.
- `academic_periods` (015) : périodes nommées par établissement (trimestres), servent de filtre de dates aux bulletins.
- Non encore créés : contrats, permissions fines.
