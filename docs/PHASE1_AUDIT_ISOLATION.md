# Audit d'isolation multi-établissements (PH1-03) — 18/11/2026

Méthode : script de lecture statique sur tous les appels `db.query(...)` de `backend/src` (appel entier lu, pas seulement la ligne).
Limite : le script vérifie seulement la présence du mot « tenant » dans la requête. Il ne prouve pas que le filtre est correct. Les tests multi-établissements ne sont pas exécutés (npm bloqué).

## Résultat
- 137 appels au total ; 58 sans le mot « tenant » dans leur texte.
- Après lecture détaillée, aucun accès inter-établissements exploitable n'a été identifié dans les modules métier.

## Classement des 58 appels
1. **Tables plateforme (superadmin)** — `platform.js`, `platformMail.js`, `invoiceData.js`, `identity.js` (cas plateforme) : tables sans `tenant_id` par conception, réservées au rôle plateforme. OK.
2. **Accès par identifiant déjà authentifié** — `auth.js` (`req.user.id`, jetons de réinitialisation hachés, `uid` issu du jeton) : l'identifiant vient du jeton ou du jeton de réinitialisation, jamais du client sans contrôle. OK.
3. **Clé d'établissement côté serveur** — `identity.js` : `key: (req) => req.tenantId`. OK.
4. **Faux positifs** — `students.js` (liste et décompte : `s.tenant_id = $1` dans la clause) et `resource.js` (`tenantCol` dans la clause). OK.
5. **Traitements système à corriger** :
   - `utils/notify.js:228` et `utils/reminders.js:75` : déduplication `notification_log WHERE kind = … AND ref = …`, sans `tenant_id`. Le `ref` contient un identifiant UUID, donc une collision est très improbable, mais la règle n'est pas explicite. **À corriger** : ajouter `AND tenant_id = $n`.
   - `utils/mailer.js` et `utils/notify.js` (mises à jour `WHERE id = $1`) : traitement de file par identifiant UUID, sans filtre d'établissement. Risque faible, mais à borner (`tenant_id` dans la clause) pour que le traitement ne touche jamais une autre ligne que celle qu'il a lue.
   - `reminders.js:77` : décompte des échecs `mail_outbox WHERE ref = $1` ; même remarque.

## Constats à traiter (Phase 1, sans décision requise)
- Ajouter `tenant_id` dans les clauses des traitements système (point 5).
- `mail_outbox.tenant_id` est en `ON DELETE SET NULL` : une suppression d'établissement détache les envois au lieu de les supprimer. Ce comportement doit être confirmé avant la phase de suppression (Phase 9).
- Aucun test multi-établissements n'a encore été exécuté : à faire dès que npm est accessible (§16.2, point 29).

## Corrections appliquées (même branche)
- `utils/notify.js` : mises à jour d'état des SMS/WhatsApp (`sent`, `failed`) bornées par `tenant_id` ; déduplication des relances d'impayés bornée par `c.tenant_id`.
- `utils/reminders.js` : déduplication (`notification_log`) et décompte des échecs (`mail_outbox`) bornés par `it.tenantId` (`IS NOT DISTINCT FROM`, pour les envois sans établissement).
- `utils/mailer.js` : mises à jour d'état après envoi (`sent`, `failed`, `skipped`) bornées par `tenantId`.

## Reste à traiter
- `utils/mailer.js` `retry(id)` : **accepté, pas de correction**. Son unique appelant est `POST /platform/mail/outbox/:id/retry`, monté après `requireSuperAdmin` (index.js). Le superadministrateur gère la file de toute la plateforme par conception ; le périmètre inter-établissements est donc voulu.
- Vérification : `node --check` uniquement. Tests multi-établissements non exécutés (npm bloqué).
