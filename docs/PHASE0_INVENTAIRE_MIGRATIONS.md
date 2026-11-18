# Phase 0 — Inventaire des migrations (17/11/2026)

Source : fichiers `database/migrations/*.sql` (lecture) et introspection de la base de test PostgreSQL 16 après application des 25 migrations + 026 (`smp_test`). Application vérifiée : 0 erreur.

## Introspection de la base de test
- Tables : **43** · clés étrangères : **56** · index : **110**
- Tables sans `tenant_id` : `password_resets` (rattachée à l'utilisateur), `plans`, `platform_counters`, `platform_identity`, `platform_settings` (plateforme), `tenants` (racine).
- Table avec `tenant_id` **sans clé étrangère** vers `tenants` : `audit_logs` (journal conservé volontairement ; à confirmer).

## Détail par migration
| Fichier | Tables créées | Colonnes ajoutées | Index créés | Suppressions | Modifications de données | Insertions |
|---|---|---|---|---|---|---|
| 001_initial_tenants_users.sql | tenants, licenses, users, audit_logs | — | 2 | 0 | non | non |
| 002_students_classes.sql | students, classes | — | 2 | 0 | non | non |
| 003_parents.sql | parents, student_parents | — | 1 | 0 | non | non |
| 004_teachers.sql | teachers, class_teachers | — | 1 | 0 | non | non |
| 005_attendances.sql | attendances | — | 3 | 0 | non | non |
| 006_grades_payments.sql | grades, payments | — | 4 | 0 | non | non |
| 007_messages_documents.sql | conversations, messages, documents | — | 2 | 0 | non | non |
| 008_stocks_notifications.sql | stock_items, notifications | — | 2 | 0 | non | non |
| 009_hr_staff.sql | staff | — | 1 | 0 | non | non |
| 010_library_canteen.sql | books, menus | — | 2 | 0 | non | non |
| 011_transport.sql | transport_routes | — | 1 | 0 | non | non |
| 012_student_individual_records.sql | — | class_id, photo_url, address, emergency_phone | 2 | 0 | non | non |
| 013_hardening.sql | tenant_counters | last_login_at, tenant_id, tenant_id, deleted_at, entity_id | 8 | 40 | oui | oui |
| 014_timetable.sql | timetable_slots | — | 2 | 0 | non | non |
| 015_academic_periods.sql | academic_periods | — | 1 | 0 | non | non |
| 016_tenant_banners.sql | tenant_banners | — | 0 | 0 | non | non |
| 017_platform_superadmin.sql | plans | plan_id, contact_name, contact_email, contact_phone, city, contract_ref, license_start, license_end, max_students, max_users, suspended_at, suspended_reason, notes | 1 | 0 | non | oui |
| 018_billing_identity.sql | platform_counters, subscription_invoices, tenant_identity, platform_identity | — | 2 | 0 | non | non |
| 019_mail_reminders_credit_notes.sql | mail_outbox, notification_log, password_resets, platform_settings, report_card_comments | document_type, credit_for, subtotal, discount_amount, tax_rate, tax_amount, last_sent_at | 4 | 1 | oui | non |
| 020_student_photos.sql | student_photos | — | 0 | 0 | non | non |
| 021_role_permissions.sql | role_permissions | — | 0 | 0 | non | non |
| 022_parent_portal.sql | parent_accounts | — | 0 | 0 | non | non |
| 023_notifications_channels.sql | notify_outbox, broadcasts, notification_settings | notify_email, notify_sms, notify_whatsapp | 2 | 0 | non | non |
| 024_unpaid_reminders.sql | — | unpaid_channels, unpaid_after_days | 0 | 1 | non | non |
| 025_mail_attachments.sql | — | attachment_name, invoice_id | 0 | 0 | non | non |
| 026_conversation_participants.sql | conversation_participants | — | 4 | 0 | non | oui |

Totaux fichiers : 43 CREATE TABLE, 36 ADD COLUMN, 47 CREATE INDEX.

## Constats
- **013_hardening.sql** : 40 `DROP CONSTRAINT` (remplacement de contraintes) et des `UPDATE` de normalisation des statuts (`payments`, `grades`, `students`) et des `tenant_id` manquants. Déjà appliquée : ne jamais la rejouer sur une base réelle sans relecture.
- Les autres migrations ne suppriment rien.
- Les migrations appliquées ne doivent pas être modifiées (règle §3.4) ; toute correction passe par une nouvelle migration.
- Test de retour arrière : non établi (pas de scripts `down`). Pour la migration 026, le retour arrière est documenté en tête de fichier.
- Mise à niveau depuis une base existante : non testée (pas de base représentative disponible).

## 027_period_closure.sql (ajoutée en Phase 1)
- Additive : `academic_periods.closed_at`, `closed_by` (nullables), clé composite `academic_periods_closed_by_fk` vers `users (id, tenant_id)`.
- Appliquée deux fois sur `smp_test` sans erreur (idempotente). Retour arrière : voir l'en-tête du fichier.
