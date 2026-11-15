# Suivi de l'audit et des corrections — School Manager Pro

Audit réalisé le 2026-11-05 sur la v2.3.4 ; corrections livrées dans la **v2.4.0** (2026-11-06) ; écrans manquants ajoutés dans la **v2.5.0** (2026-11-06), puis sessions/mots de passe/bulletins dans la **v2.6.0**, puis les périodes scolaires dans la **v2.7.0** (2026-11-06), puis l'affiche d'accueil personnalisable dans la **v2.8.0** l'espace superadmin dans la **v2.9.0** (2026-11-07), puis la facturation des abonnements et l'identité personnalisable dans la **v2.10.0** (2026-11-09), puis e-mails, rappels, TVA / avoirs, mot de passe oublié, commentaires de bulletin et sauvegarde dans la **v2.11.0** (2026-11-13), puis photos d'élèves et emploi du temps dans la **v2.12.0** (2026-11-13) et permissions fines dans la **v2.13.0** (2026-11-14).
Légende : [x] corrigé et vérifié · [~] corrigé en partie · [ ] à faire.

## P0 — avant toute mise en ligne
- [x] C1 Authentification JWT réelle, middlewares sur toutes les routes (tests unitaires + intégration : 401 sans jeton, jeton falsifié, expiré, `alg=none`)
- [x] C2 Établissement déduit du jeton ; plus aucun `OR $1 IS NULL` (test : en-tête `x-tenant-id` et `?tenant_id` ignorés pour un admin ; lecture, modification et suppression inter-établissements → 404)
- [x] C3 Migration 013 : `tenant_id NOT NULL` partout (testée : montée depuis 012 avec données, rejeu, chaîne 001→013, refus en présence d'orphelins)
- [x] C4 Plus de tenant par défaut dans le navigateur ; UUID invalide → 400 au lieu de 500
- [x] M2 `</div>` en trop retiré ; structure HTML vérifiée équilibrée

## P1 — fiabilité fonctionnelle
- [x] M1 `student_id` / `class_id` : listes de choix et valeurs d'identifiants gardées en texte, sans `Number()`
- [x] M3 Statuts de paiement unifiés (`paye`, `en_attente`, `annule`) ; total du mois calculé en SQL
- [x] M4 / M5 Validation des entrées (400 détaillé), `CHECK` en base, erreurs sans détail interne (plus aucun `err.message` renvoyé)
- [x] M6 / M7 Clés étrangères composites ; présences uniques même sans classe ; reçus `R-AAAA-NNNNNN` uniques par établissement et sans trou
- [x] M8 / M12 Pagination (défaut 50, plafond 200) ; 404 JSON sur `/api/*` ; fichier statique manquant → 404
- [x] F4 En-têtes de sécurité, CSP, CORS en liste blanche, limitation de débit, gestionnaire d'erreurs global (écrits sans dépendance plutôt que `helmet`/`cors` : à remplacer si vous préférez ces paquets)

## P2 — qualité et déploiement
- [x] F1 Tests automatisés : 25 unitaires + 83 d'intégration (`node:test` et `fetch`, sans `supertest`)
- [~] F2 `package-lock.json` : **non généré** (pas d'accès au registre npm ici). Lancer `npm install` une fois et conserver le fichier créé
- [x] F3 `.gitignore`, `.env.example` aligné sur les variables réellement lues
- [x] M9 Tailwind compilé, FontAwesome et Inter en local, plus aucune requête externe (vérifié au navigateur)
- [x] M10 PWA : manifeste, service worker à la racine, icônes PNG, cache versionné, démarrage hors ligne vérifié, API jamais mise en cache
- [x] M11 Suppression logique des élèves ; journal d'audit alimenté (création, modification, suppression, paiement, connexion)
- [x] Documentation réalignée (README, CHANGELOG, ROADMAP, ARCHITECTURE, DATA_MODEL, PLAN_TESTS, INTEGRATION)

## P3 — fonctionnalités
- [x] F7 API réelle : établissements (superadmin), RH, bibliothèque, cantine, transport, statistiques
- [x] Vues Élèves, Enseignants, Classes, Notes, Présences, Paiements, Bibliothèque, Cantine, Transport, Notifications, Conversations
- [x] Vues Rapports (synthèses + export CSV) et Paramètres (établissement, utilisateurs, mot de passe)
- [x] Fil de messages, écrans RH / Documents / Stocks
- [x] Emploi du temps (migration 014, API, grille, refus des chevauchements)
- [x] Gestion des utilisateurs et changement de son mot de passe depuis l'interface
- [x] Révocation immédiate des sessions (compte revérifié à chaque requête) et rôle appliqué en temps réel
- [x] Réinitialisation du mot de passe par l'administrateur
- [x] Bulletin de notes (moyennes pondérées, rang, appréciation)
- [x] Réinitialisation par e-mail (v2.11.0) : lien à usage unique de 1 h ; nécessite `SMTP_*`, `MAIL_FROM` et `APP_URL`
- [x] Périodes scolaires nommées (trimestres) pour les bulletins
- [x] Appréciation automatique par matière sur le bulletin
- [x] Facturation des abonnements (v2.10.0) : factures numérotées, encaissement avec prolongation de licence, retards, export CSV, « Mon abonnement » côté école
- [x] Identité personnalisable (v2.10.0) : nom, slogan, logo carré contrôlé, plateforme et établissements
- [x] Espace superadmin (v2.9.0) : établissements, packs, licences, quotas, suspension sans suppression, mots de passe des administrateurs, journal ; le superadmin n'accède plus aux données privées des écoles
- [x] Affiche d'accueil personnalisable par établissement (format 4:1, 1200×300 à 3200×800 px, PNG/JPEG/WebP, 2 Mo) avec affiche par défaut (v2.8.0)
- [x] Commentaires des enseignants et décision du conseil sur le bulletin (v2.11.0) ; impression / PDF via le navigateur
- [x] Export PDF généré côté serveur : bulletins (v2.15.0) et factures / avoirs (v2.18.0)
- [x] Rappels automatiques par e-mail : licences et factures impayées (v2.11.0)
- [x] Envoi des factures par e-mail, TVA, remises, avoirs (v2.11.0)
- [~] Paiement en ligne Orange Money / Moov Money : **volontairement désactivé et signalé « indisponible »** (v2.11.0) ; intégration réelle non réalisée
- [x] Téléversement sécurisé des photos d'élèves (v2.12.0) : signature binaire, 1 Mo, réduction côté navigateur, stockage en base
- [x] Emploi du temps : vue par enseignant et refus des salles en conflit (v2.12.0)
- [x] Licences, packs, quotas (v2.9.0)
- [x] Permissions fines par module et par rôle (v2.13.0)
- [x] Affichage sur téléphone (v2.22.0) : menu en panneau, en-tête et barre d'outils adaptés ; contrôle automatique à 390 px sur 10 écrans sans débordement. [ ] Reste à valider sur de vrais téléphones (Android bas de gamme, Safari iOS) et à repenser le grand bandeau d'accueil du tableau de bord sur mobile (texte superposé à l'illustration)
- [x] Exports Excel (CSV) élèves / notes / paiements (v2.21.0) : bouton « Exporter » dans les listes, droit de lecture du module, tracé dans le journal d'audit, plafond 20 000 lignes, formules Excel neutralisées. [!] Ces fichiers contiennent des données personnelles : à conserver et partager avec précaution
- [x] Reçus de paiement PDF (v2.20.0) : bouton « Reçu » dans la liste des paiements et dans le portail parent ; paiements encaissés uniquement ; montant en chiffres et en lettres
- [x] Audit de sécurité final (v2.19.0) : (1) analyse automatique de toutes les requêtes SQL hors espace superadmin : aucune lecture ou écriture sans filtre d'établissement (les seules requêtes sans filtre portent sur le journal d'envoi qu'on vient de créer ou sur des paramètres de plateforme) ; (2) toute route d'écriture est protégée (droit par module ou rôle) hormis connexion, mot de passe oublié/réinitialisé et changement de son propre mot de passe, limités en débit ; les routes parents sont réservées à l'administrateur ; (3) isolation : l'établissement vient uniquement du jeton (en-tête x-tenant-id ignoré), parent cloisonné au portail ; (4) en-têtes de sécurité, CSP stricte, CORS fermé par défaut, corps JSON limité à 100 Ko, secret JWT obligatoire en production, exports CSV protégés contre l'injection de formules ; (5) correction : **plafond journalier de SMS / WhatsApp par établissement** (`NOTIFY_DAILY_LIMIT`, 500 par défaut, 0 = illimité) pour limiter coût et abus en cas de compte compromis.
- [!] Points non couverts par cet audit (à faire par un tiers avant ouverture au public) : test d'intrusion réel, analyse des dépendances (`npm audit`, nécessite le registre), limitation de débit partagée entre plusieurs instances (aujourd'hui en mémoire, une seule instance).
- [x] PDF des factures et avoirs : joint aux e-mails d'envoi (et aux nouveaux essais), bouton « PDF » sur l'écran facture (v2.18.0)
- [x] Rappels d'impayés aux parents (v2.17.0) : manuel (aperçu puis envoi) et automatique (à N jours puis 2 relances à 14 jours), un message par parent avec détail par enfant ; impayé = paiement « en attente »
- [x] Notifications SMS / WhatsApp / e-mail (v2.16.0) : testé avec un faux fournisseur ; [!] à configurer par vous : compte Twilio (variables TWILIO_*), SMTP ; WhatsApp hors fenêtre de 24 h exige des modèles approuvés (non gérés)
- [x] Export PDF serveur des bulletins (v2.15.0), administration et portail parent
- [x] Portail parent (v2.14.0) : un compte « parent » est lié à une fiche responsable et ne voit que les enfants rattachés (notes, présences, paiements, bulletin, emploi du temps, photo) ; tout le reste de l'API lui est fermé côté serveur (403). Le rôle « parent » n'est plus configurable dans la matrice (accès fixe). Créez les accès depuis la fiche élève → Parents et responsables.
- [!] Attention : un compte « Utilisateur » créé à la main (rôle `user`) garde l'accès en lecture historique ; n'utilisez le rôle « Parent » que via la fiche élève.
- [x] Sauvegarde / restauration (`npm run backup` / `restore`, guide) et guide de déploiement Windows (v2.11.0)

## Limites de la vérification (à lire)
- Les tests ont tourné sur **PostgreSQL 16 réel**, mais avec un **banc de simulation** à la place des paquets `express` et `pg` (indisponibles hors ligne). Le code est écrit pour Express 4 et `pg` 8 ; `NUMERIC` revient en chaîne avec le vrai `pg` (le code et l'interface convertissent avec `Number()`), alors que le banc le renvoie en nombre. **Relancez les deux suites avec les vrais paquets** (voir `docs/PLAN_TESTS.md`).
- Navigateur : Chromium (Playwright), sous Linux. Non testé sous Windows ni sur mobile réel.
- Chaque requête authentifiée coûte une lecture SQL supplémentaire (vérification du compte) : négligeable à l'échelle d'une école, à surveiller en cas de forte charge.
- Le jeton est conservé dans `localStorage` (protégé par la CSP stricte). Un cookie `HttpOnly` serait plus robuste si l'exposition l'exige.
- Aucun test de charge.
- **E-mails** : testés contre un faux serveur SMTP local (STARTTLS / TLS implicite non testés contre un vrai fournisseur). À valider avec vos identifiants réels via l'écran « E-mails » → « Envoyer un test ». Pas de pièce jointe PDF.
- **Paiement en ligne** : non disponible (voir ci-dessus).
- Sauvegarde / restauration vérifiées sous Linux seulement.

## Pour passer en production
1. `npm install`, puis `npm test` et `npm run test:integration` avec les vrais paquets.
2. Configurer `SMTP_*`, `MAIL_FROM`, `APP_URL` (sinon aucun e-mail, ni « mot de passe oublié »), planifier `npm run backup`.
3. `JWT_SECRET` aléatoire (32 caractères minimum), `NODE_ENV=production`, HTTPS devant l'application, `TRUST_PROXY=true` si proxy.
4. Sauvegarder la base, puis `npm run migrate` (la migration 013 s'arrête s'il reste des lignes sans établissement).
5. Créer les comptes avec `npm run create-user` ; ne pas utiliser `seed` en production.
