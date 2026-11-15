# Changelog

## [2.22.0] - 2026-11-15 — Affichage sur téléphone
- Revue des écrans à 390 px de large (connexion, tableau de bord, élèves, paiements, communication, emploi du temps, paramètres, rapports, fiche élève, bulletin) : plus aucun débordement horizontal.
- **Menu latéral** : sur écran étroit (< 1024 px) il devient un panneau par-dessus le contenu, fermé au départ, avec fond cliquable et fermeture par la touche Échap ou au choix d'une rubrique ; sur grand écran, comportement inchangé.
- **En-tête** : marges réduites, recherche réductible, date masquée sur petit écran (cloche toujours visible).
- **Listes** : la barre d'outils (recherche, Actualiser, Exporter, Ajouter) passe à la ligne au lieu de sortir de l'écran.
- Aucun changement côté serveur ni base de données.

## [2.21.0] - 2026-11-15 — Exports Excel (CSV)
- **Bouton « Exporter »** dans les listes Élèves, Notes et Paiements : fichier CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre dans Excel avec les accents). `GET /api/students|grades|payments/export.csv`, mêmes filtres que la liste (recherche élèves), 20 000 lignes au plus.
- L'export élèves ajoute classe, niveau, année, adresse, téléphone d'urgence et **responsable principal** (nom, téléphone, e-mail).
- Droits : ceux de lecture du module (donc modifiables dans Paramètres → Permissions) ; un compte parent n'y a pas accès ; chaque export est tracé dans le journal d'audit ; cellules commençant par `= + - @` neutralisées contre l'injection de formules. Tests : 25 unitaires, 83 d'intégration.

## [2.20.0] - 2026-11-15 — Reçus de paiement en PDF
- **Reçu PDF** (A4) pour tout paiement encaissé : établissement, élève (matricule, classe, année), objet, mode, numéro de reçu, montant en chiffres **et en lettres** (« Quatre-vingt-cinq mille francs CFA »), cachet et signature. Un paiement « en attente » renvoie 409 ; un paiement annulé n'a pas de reçu.
- **Administration** : bouton « Reçu » dans la liste des paiements (`GET /api/payments/:id/receipt.pdf`, droit de lecture sur « Paiements »). **Portail parent** : bouton « PDF » sur chaque paiement encaissé de son enfant (`GET /api/portal/children/:id/payments/:paymentId/receipt.pdf`, 404 si le paiement n'est pas celui de cet enfant).
- Montant en lettres conforme à l'orthographe (quatre-vingts, deux cents, mille invariable, millions). Tests : 25 unitaires, 82 d'intégration.

## [2.19.0] - 2026-11-15 — Audit de sécurité final
- Analyse automatique des requêtes SQL (hors espace superadmin) : toutes filtrent par établissement ; revue des routes d'écriture (toutes protégées sauf authentification, limitées en débit), de l'isolation (établissement tiré du jeton uniquement), des en-têtes et de la configuration.
- **Plafond journalier de SMS / WhatsApp par établissement** (`NOTIFY_DAILY_LIMIT`, 500 par défaut, 0 = illimité) : au-delà, les messages sont consignés comme ignorés avec le motif « Plafond journalier atteint » ; s'applique aux envois groupés, rappels d'impayés et alertes d'absence. Test d'intégration ajouté (81).

## [2.18.0] - 2026-11-15 — PDF des factures joints aux e-mails
- **Facture ou avoir en PDF** (A4 : émetteur, établissement facturé, période, sous-total, remise, TVA, total TTC, avoirs, statut de paiement, modalités, mentions légales), généré par le serveur avec le générateur existant.
- **Joint automatiquement** à l'e-mail d'envoi de facture ; lors d'un nouvel essai d'un envoi non parti ou en échec, la facture est régénérée et jointe. Bouton **« PDF »** sur l'écran facture (superadmin) ; `GET /api/platform/invoices/:id/pdf`.
- Le client SMTP gère les **pièces jointes** (multipart/mixed, base64, nom de fichier assaini contre l'injection d'en-têtes). Journal : nom de la pièce jointe conservé (le fichier n'est pas stocké). Migration 025. Tests : 24 unitaires, 80 d'intégration.

## [2.17.0] - 2026-11-14 — Rappels d'impayés aux parents
- **Section « Rappels d'impayés »** (écran Communication) : liste des responsables ayant des paiements « en attente » (montant, ancienneté, canaux joignables) puis « Envoyer les rappels » par SMS, WhatsApp et/ou e-mail. **Un seul message par responsable**, avec le détail par enfant et le total.
- **Rappels automatiques** (administrateur) : canaux au choix, premier rappel après N jours (1 à 90, 7 par défaut), puis 2 relances à 14 jours d'intervalle ; chaque rappel n'est envoyé qu'une fois (`notification_log`) et s'arrête dès que le paiement est réglé. Un canal non configuré n'est pas « consommé » : l'envoi aura lieu dès sa configuration. Exécuté par le planificateur existant (toutes les 6 h).
- Les envois manuels apparaissent dans l'historique ; les préférences de chaque parent restent respectées. Migration 024. Tests : 23 unitaires, 80 d'intégration (1 nouveau).

## [2.16.0] - 2026-11-14 — Notifications aux parents : SMS, WhatsApp, e-mail
- **Écran « Communication »** : message groupé aux parents de tous les élèves actifs, d'une classe ou d'un seul élève (bouton « Écrire aux parents » sur la fiche), par SMS, WhatsApp et/ou e-mail ; aperçu du nombre de responsables joignables ; variables `{parent}` et `{enfants}` ; un responsable ayant plusieurs enfants ne reçoit qu'un message ; historique (envoyés / échecs / ignorés).
- **Alerte automatique d'absence** (réglage administrateur) : un élève noté absent prévient ses responsables sur les canaux choisis, une seule fois par élève et par jour ; une alerte ne fait jamais échouer la saisie de présence.
- **Préférences par responsable** (accepte SMS / WhatsApp / e-mail) respectées à chaque envoi. Numéros normalisés au format international (8 chiffres → +223, `DEFAULT_COUNTRY_CODE`).
- **Fournisseur** : SMS et WhatsApp via Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM`), isolé dans `utils/notify.js` ; e-mail via le SMTP existant. **Sans configuration, le canal est « indisponible » et l'envoi est refusé (409)** ; rien ne plante. Tous les envois sont consignés (`notify_outbox`, `mail_outbox`).
- Limite connue : WhatsApp n'accepte un texte libre que dans les 24 h suivant un message du parent ; sinon un modèle approuvé par Meta est exigé (non géré ; l'erreur du fournisseur est consignée).
- Droits : module « Notifications » (lecture : consulter ; écriture : envoyer). Migration 023. Tests : 23 unitaires, 79 d'intégration (3 nouveaux).

## [2.15.0] - 2026-11-14 — Bulletin PDF généré par le serveur
- **« Télécharger le PDF »** sur le bulletin (administration et portail parent) : A4, en-tête de l'établissement, moyennes par matière, moyenne générale, rang, mention, appréciation et décision du conseil, zones de signature ; filtre de période respecté. `GET /api/students/:id/report-card.pdf` (droit de lecture sur « Élèves ») et `GET /api/portal/children/:id/report-card.pdf` (enfants rattachés uniquement, 404 sinon).
- Générateur PDF **sans dépendance** (`utils/pdf.js`) : Helvetica, accents français (WinAnsi), retour à la ligne, plusieurs pages si besoin, table xref exacte. Le bouton « Imprimer » reste disponible.
- Tests : 23 unitaires (3 nouveaux : structure PDF, encodage, pagination), 76 d'intégration (1 nouveau).

## [2.14.0] - 2026-11-14 — Portail parent
- **Comptes parents** : depuis la fiche élève (Parents et responsables), l'administrateur ajoute un responsable (un responsable déjà connu — même e-mail, ou même téléphone et même nom — est réutilisé : un parent suit tous ses enfants avec un seul compte) puis « Créer un accès parent » (mot de passe provisoire généré, affiché une seule fois, ou choisi). Suppression de l'accès et retrait du lien possibles.
- **Écran « Mes enfants »** (lecture seule) : cartes des enfants rattachés, puis dossier (photo, classe, emploi du temps, notes, présences, paiements) et bulletin (moyennes, rang, appréciation du conseil). Les coordonnées des autres responsables ne sont pas exposées.
- **Cloisonnement côté serveur** : chaque accès à un enfant est revérifié en base (404 sinon) ; un compte parent reçoit 403 sur toute autre route que `/api/portal` (et la lecture des paramètres d'affichage). Le portail est fermé aux autres rôles.
- Les comptes parents ne comptent pas dans le quota d'utilisateurs ; leur rôle n'est pas modifiable ; le rôle « parent » sort de la matrice de permissions (accès fixe). Corrigé : message « 12 caractères » → 8 à la réinitialisation par lien.
- Migration 022 (`parent_accounts`). Lectures de dossier et de bulletin factorisées (`utils/studentData.js`). Tests : 20 unitaires, 75 d'intégration (4 nouveaux).

## [2.13.0] - 2026-11-14 — Permissions fines par module
- **Matrice de permissions par établissement** : pour chacun des 17 modules (élèves, classes, enseignants, emploi du temps, notes, présences, paiements, messages, bibliothèque, cantine, transport, RH, documents, stocks, rapports, périodes, notifications) et chaque rôle (enseignant, comptable, personnel, parent, utilisateur), l'administrateur choisit **aucun accès / lecture / lecture et modification** dans Paramètres → « Permissions par module ». Effet immédiat, cases modifiées surlignées, retour aux valeurs par défaut (tous les rôles ou un seul).
- **Valeurs par défaut = comportement historique** (aucun changement tant que rien n'est modifié). Seules les dérogations sont stockées (`role_permissions`, migration 021).
- L'administrateur garde **toujours tous les droits** et n'est pas configurable (impossible de se verrouiller dehors). Comptes, paramètres, identité et abonnement restent réservés à l'administrateur. Isolation par établissement testée.
- Appliqué côté serveur (403 `module_forbidden`) sur **toutes les routes de lecture** (garde au montage des modules) et d'écriture (garde remplaçant les anciens contrôles de rôle) ; l'appréciation de bulletin suit le droit d'écriture sur « Notes », la photo d'élève celui sur « Élèves ».
- Interface : menu réduit selon les droits, boutons d'ajout / modification affichés selon le niveau (`GET /api/auth/me` renvoie les droits du compte).
- Tests : 20 unitaires, 71 d'intégration (5 nouveaux). Banc de test : `app.use(chemin, garde, routeur)` désormais supporté.

## [2.12.0] - 2026-11-13 — Photos d'élèves et emploi du temps
### Photos d'élèves (téléversement sécurisé)
- L'administrateur peut changer ou retirer la photo depuis le dossier de l'élève. Le navigateur **réduit la photo** (800 px maximum, JPEG) avant l'envoi : une photo de téléphone de plusieurs Mo passe sans manipulation.
- Contrôle côté serveur sur la **signature binaire** (PNG / JPEG / WebP uniquement, SVG et autres refusés), 1 Mo maximum, 128 à 2000 px, rapport largeur/hauteur de 0,5 à 2. Stockage en base (incluse dans les sauvegardes). Lecture réservée aux utilisateurs connectés de l'établissement (la photo n'a pas d'URL publique), isolation entre établissements testée. L'ancienne `photo_url` reste utilisée tant qu'aucune photo n'est téléversée.
- Migration 020 : `student_photos`.
### Emploi du temps
- **Salle en conflit** : un créneau est refusé (409 « Cette salle est déjà occupée sur ce créneau. ») si la salle est déjà prise au même moment (casse et espaces ignorés), en plus des conflits de classe et d'enseignant.
- **Vue par enseignant** : bascule « Par classe / Par enseignant » dans l'écran, affichant les cours de l'enseignant avec leur classe.
### Technique
- `utils/image.js` : exigences photo et contrôle de proportions par plage. Tests : 20 unitaires, 66 d'intégration.

## [2.11.0] - 2026-11-13 — E-mails, rappels, TVA / avoirs, mot de passe oublié, bulletin, sauvegarde
### E-mails
- Client SMTP **sans dépendance** (`node:net` / `node:tls`) : STARTTLS ou TLS implicite, AUTH PLAIN / LOGIN, MIME base64, protection contre l'injection d'en-têtes. Configuration par variables d'environnement (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_URL`). **Sans configuration, rien n'est envoyé ni perdu** : l'écran l'indique.
- Journal de tous les envois (`mail_outbox`) avec statut, tentatives et raison de l'échec ; nouvel essai en un clic. Écran superadmin « E-mails » : état (le mot de passe SMTP n'est jamais exposé), envoi de test, journal, simulation / exécution des rappels.
### Rappels automatiques
- Fin de licence (30, 15, 7 jours avant, jour J, après expiration) et factures impayées (3, 10, 17 jours de retard, nets des avoirs). Destinataires : e-mail de contact de l'école, sinon jusqu'à 3 administrateurs actifs. Un rappel n'est envoyé qu'une fois (`notification_log`) ; abandon après 3 échecs. Planificateur : 1 minute après le démarrage puis toutes les 6 heures (`MAIL_SCHEDULER=false` pour le couper).
### Facturation
- **TVA** (taux par défaut dans « Réglages » ou par facture) et **remises** (% ou montant) : total = (HT − remise) + TVA. Mentions légales et modalités de paiement (RIB, numéros Orange / Moov) imprimées sur la facture.
- **Avoirs** `A-AAAA-NNNN` : partiels ou totaux, plafonnés au solde restant ; une facture en attente entièrement créditée est annulée ; l'avoir ne modifie pas la licence. Totaux, retards et CSV tiennent compte des avoirs (montants négatifs dans le CSV).
- **Envoi des factures et avoirs par e-mail** (horodaté `last_sent_at`).
- **Paiement en ligne (Orange Money / Moov Money) : volontairement INDISPONIBLE.** Les fournisseurs sont listés, le bouton « Payer en ligne » est grisé avec la mention « Indisponible pour le moment », l'API répond 503 `online_payment_unavailable`. Aucune variable d'environnement ne peut l'activer : une vraie intégration (identifiants marchands, notifications serveur) est à réaliser.
### Comptes
- **Mot de passe oublié** : lien à usage unique valable 1 h (jeton aléatoire stocké sous forme d'empreinte SHA-256), réponse identique que le compte existe ou non, limitation de débit, anciens liens invalidés. Si l'envoi d'e-mails n'est pas configuré, l'écran le dit (503) au lieu de faire semblant.
### Bulletin
- **Appréciation de l'enseignant** (600 caractères) et **décision du conseil** (liste fixe), par élève et par période, saisies par l'administrateur ou l'enseignant ; imprimées avec zones de signature (Imprimer / PDF du navigateur).
### Exploitation
- `npm run backup` (pg_dump compressé, rotation) et `npm run restore` (`--confirm` obligatoire) — vérifiés : sauvegarde puis restauration donnent les mêmes effectifs. Guides `docs/SAUVEGARDE_RESTAURATION.md` et `docs/DEPLOIEMENT_WINDOWS.md`. `.env.example` complété.
### Technique
- Migration 019 : `mail_outbox`, `notification_log`, `password_resets`, `platform_settings`, `report_card_comments`, colonnes de TVA / remise / avoir sur `subscription_invoices`.
- Banc de test : détection « instruction unique » corrigée (les valeurs contenant « ; » faussaient la lecture des résultats).
- Tests : 19 unitaires (dont client SMTP contre faux serveur), 64 d'intégration.

## [2.10.0] - 2026-11-09 — Facturation des abonnements et identité personnalisable
### Facturation (superadmin)
- Factures d'abonnement numérotées `F-AAAA-NNNN` (compteur de plateforme, atomique avec l'insertion). Montant calculé depuis le prix mensuel du pack × durée, ou saisi librement ; période facturée à la suite de la licence en cours ; échéance par défaut à 15 jours.
- **Encaissement** (espèces, virement, Orange Money, Moov Money, chèque, autre) avec référence et date : la licence est prolongée jusqu'à la fin de la période facturée (option désactivable). Impossible de payer deux fois, de payer une facture annulée, ou d'annuler une facture payée.
- Écran « Facturation » : filtres (statut dont « en retard », dates), totaux encaissé / en attente / en retard, facture imprimable (Imprimer / PDF), export CSV (UTF-8 avec BOM, anti-injection de formules). Export CSV de la liste des établissements. Factures listées sur la fiche de chaque établissement et indicateurs financiers sur la vue d'ensemble.
- Côté établissement : section « Mon abonnement » dans Paramètres (pack, licence, quotas, factures non annulées), lecture seule, administrateur uniquement.
### Identité personnalisable
- **Nom, slogan et logo** modifiables : par la plateforme (superadmin, valeurs par défaut, visibles sur la page de connexion) et par chaque établissement (administrateur). Priorité : établissement > plateforme > valeurs intégrées. Le nom et le logo s'appliquent au menu, à la page de connexion, au pied de page, au titre de l'onglet et au message de bienvenue.
- Logo : carré 1:1 (±2 %), 128×128 à 1024×1024 px, PNG / JPEG / WebP, 512 Ko maximum, contrôlé sur sa signature binaire et revérifié côté serveur.
- Migration 018 : `subscription_invoices`, `platform_counters`, `tenant_identity`, `platform_identity`.
### Technique
- `utils/image.js` généralisé (`checkImage`, `checkLogo`) ; `utils/csv.js` partagé ; règles d'impression (seul le contenu du module est imprimé).
- Corrigé : l'icône FontAwesome restait visible sous le logo (son `display` l'emportait sur la classe `hidden`).
- Tests : 16 unitaires, 55 d'intégration.

## [2.9.0] - 2026-11-07 — Espace superadmin (plateforme)
### Ajouté
- **Espace superadmin** dédié (menu « Plateforme ») : vue d'ensemble (établissements actifs, suspendus, licences expirées ou proches de l'échéance, quotas presque atteints, dernières actions), liste filtrable des établissements, fiche détaillée, packs et quotas, journal de la plateforme, changement de mot de passe.
- **Création d'un établissement avec son premier administrateur** en une transaction ; mot de passe temporaire généré (affiché une seule fois) si aucun n'est fourni.
- **Packs** (Essentiel, Standard, Premium fournis ; création, modification, désactivation, jamais de suppression). Appliquer un pack copie ses quotas sur l'établissement ; modifier un pack n'a pas d'effet rétroactif.
- **Licences** : début, fin, référence de contrat, renouvellement de 3/6/12 mois. Une licence expirée coupe l'accès.
- **Quotas** d'élèves et d'utilisateurs appliqués à la création (403 `quota_exceeded` avec message clair). Quota vide = illimité.
- **Suspension sans suppression** : accès coupé immédiatement (jeton existant et connexion), données conservées, réactivation possible, motif enregistré.
- **Administrateurs d'établissement** : réinitialisation du mot de passe (limitée au rôle admin de l'établissement concerné), activation / désactivation.
- Migration 017 : table `plans`, colonnes de licence et de contact sur `tenants`.
### Modifié (sécurité)
- **Le superadmin n'a plus aucun accès aux données des établissements** (élèves, notes, paiements, RH, utilisateurs, paramètres) : l'en-tête `x-tenant-id` est ignoré et les routes métier répondent 403. Ses actions sont journalisées sans établissement (invisibles dans l'activité des écoles).
- `/api/tenants` est remplacé par `/api/platform/tenants`. `requireRole` ne laisse plus passer le superadmin par défaut.
- Connexion et chaque requête vérifient l'état de l'établissement (suspendu, licence expirée) ; le message n'est donné qu'avec un mot de passe correct.
- Tests : 15 unitaires, 48 d'intégration.

## [2.8.0] - 2026-11-07 — Affiche d'accueil personnalisable
- Le bandeau « Bienvenue » du tableau de bord devient une **affiche** propre à chaque établissement, avec une **affiche par défaut** illustrée (`banner-default.svg`, école, livres, toque).
- **Exigences imposées** (client et serveur) : format 4:1 (±2 %), 1200×300 à 3200×800 px, PNG / JPEG / WebP, 2 Mo maximum. Le type est lu dans la signature binaire du fichier (pas d'SVG accepté, donc aucun script embarqué).
- Migration 016 : table `tenant_banners` (image `bytea`, dimensions, titre et sous-titre facultatifs, contraintes de type et de poids).
- API : `GET /api/settings/banner` (tous), `GET /api/settings/banner/image`, `PUT /api/settings/banner/image` (administrateur), `PUT /api/settings/banner/text`, `DELETE /api/settings/banner` (retour à l'affiche par défaut). Journal d'audit sur chaque changement.
- Paramètres : section « Affiche d'accueil » (aperçu, exigences, contrôle avant envoi, messages d'erreur précis, textes, réinitialisation).
- CSP : `img-src` accepte `blob:` (l'image est téléchargée avec le jeton puis affichée localement).
- Tests : 15 unitaires, 40 d'intégration. Appliquer la migration 016 (`npm run migrate`).

## [2.7.2] - 2026-11-06
- Tableau de bord : le journal des activités affiche des libellés en français au lieu des noms techniques.

## [2.7.1] - 2026-11-06
- Bulletin : appréciation par matière (calculée depuis la moyenne de la matière, mêmes seuils que la mention générale).

## [2.7.0] - 2026-11-06 — Périodes scolaires
- Migration 015 : table `academic_periods` (nom unique par établissement, fin ≥ début).
- API `/api/periods` (lecture : tous ; création et suppression : administrateur).
- Paramètres : gestion des périodes (trimestres, semestres). Bulletin : choix d'une période qui remplit les dates.
- Tests : 39 tests d'intégration. Appliquer la migration 015 (`npm run migrate`).


## [2.6.0] - 2026-11-06 — Sessions, mots de passe, bulletins
### Ajouté
- **Révocation immédiate** : à chaque requête, le compte est revérifié en base. Un compte désactivé est déconnecté aussitôt ; un changement de rôle s'applique dès la requête suivante (au prix d'une requête SQL légère par appel).
- **Mot de passe oublié** : l'administrateur réinitialise le mot de passe d'un utilisateur (`PUT /api/users/:id/password`, bouton « Mot de passe » dans Paramètres). Pas de réinitialisation par e-mail (aucun service d'envoi n'est configuré).
- **Bulletin** : `GET /api/students/:id/report-card` (moyennes pondérées par coefficient, moyenne générale, rang dans la classe, appréciation, période facultative) et écran imprimable accessible depuis le dossier de l'élève.
- Tests : 38 tests d'intégration.

### Règle de calcul
Moyenne d'une matière = Σ(note × coefficient) / Σ(coefficients). Moyenne générale = moyenne pondérée des matières par la somme de leurs coefficients. Les notes annulées sont ignorées. Mentions : ≥ 16 Très bien, ≥ 14 Bien, ≥ 12 Assez bien, ≥ 10 Passable, sinon Insuffisant.


## [2.5.0] - 2026-11-06 — Écrans manquants
### Ajouté
- **Emploi du temps** : migration 014 (`timetable_slots`, clés composites), API `/api/timetable` (création, suppression, filtres), refus des chevauchements de classe ou d'enseignant (409), grille hebdomadaire imprimable.
- **Rapports** : `/api/reports/overview` (élèves par classe, encaissements par type de frais, présences sur 30 jours, moyennes par matière) et export CSV des paiements (`/api/reports/payments.csv`, protégé contre l'injection de formules Excel).
- **Paramètres** : fiche et renommage de l'établissement, gestion des utilisateurs (`/api/users` : création, rôle, désactivation), changement de son mot de passe (`POST /api/auth/password`).
- **Messages** : fil de discussion avec nom de l'expéditeur (l'API joint maintenant `sender_name`).
- **RH, Documents, Stocks** : écrans de liste et de création.
- Tests : 36 tests d'intégration (4 nouveaux scénarios) ; test navigateur étendu aux nouveaux écrans.

### À savoir
- Un compte désactivé ne peut plus se connecter, mais un jeton déjà émis reste valable jusqu'à son expiration (8 h par défaut).
- Appliquer la migration 014 (`npm run migrate`).


## [2.4.0] - 2026-11-06 — Correctifs de l'audit
Version issue de l'audit complet de la v2.3.4. Détail du suivi : `docs/AUDIT_SUIVI.md`.

### Sécurité
- Authentification réelle : connexion e-mail + mot de passe (scrypt), jeton JWT HS256 signé, expiration configurable (C1).
- L'établissement est déduit du jeton ; l'en-tête `x-tenant-id` n'est honoré que pour le superadmin. Suppression de tous les `OR $1 IS NULL` (C2).
- En-têtes de sécurité (CSP stricte sans CDN, nosniff, anti-framing), CORS à liste blanche, limitation de débit (API et tentatives de connexion) (F4).
- Les erreurs PostgreSQL ne divulguent plus aucun détail interne ; messages homogènes (M4, M5).

### Base de données (migration 013, à appliquer après 001-012)
- `tenant_id NOT NULL` partout, clés étrangères composites `(tenant_id, id)`, contrôles `CHECK`, unicité des présences et des reçus par établissement (C3, M6, M7).
- Numérotation des reçus par établissement sans trou (`tenant_counters`), vocabulaire de statuts unifié (M3, M7).
- Suppression logique des élèves, journal d'audit alimenté par l'API (M11).
- `gen_random_uuid()` à la place de `uuid-ossp` (PostgreSQL 13+ requis).

### API
- Validation stricte des entrées (400 détaillé), pagination (`limit`/`offset`, `meta.total`), 404 JSON pour `/api/*`, gestion d'erreurs centralisée (M4, M8, M12).
- Nouveaux : `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/stats/dashboard`, `/api/tenants` (superadmin).
- `createApp()` exporté : l'application est testable sans ouvrir de port.

### Interface et PWA
- Tailwind compilé (`npm run build:css`), FontAwesome et Inter servis en local : plus aucun CDN ni image externe (M9).
- Écran de connexion, déconnexion réelle, tableau de bord alimenté par les statistiques SQL, graphique SVG, recherche déroulante, modales à la place de `prompt()`/`alert()`, identifiants saisis sans conversion numérique (M1, M2).
- Valeurs en dur supprimées (badges, date, année, version, tenant par défaut) (C4).
- PWA fonctionnelle : manifeste et service worker à la racine, icônes PNG, cache versionné, API jamais mise en cache, démarrage hors ligne vérifié (M10).

### Outillage
- Scripts `migrate` (transactionnel), `seed` (mot de passe généré), `create-user`.
- Tests : 10 unitaires + 32 d'intégration (PostgreSQL de test) ; `npm test`, `npm run test:integration`.
- `.env.example` aligné sur les variables réellement lues ; `.gitignore`.

### Changements incompatibles
- Toutes les routes `/api/*` (sauf `/api/health` et `/api/auth/login`) exigent un jeton.
- `JWT_SECRET` (32 caractères minimum) est obligatoire en production.
- Appliquer la migration 013 : elle s'arrête si des lignes sans `tenant_id` existent (à rattacher ou supprimer avant).

## [2.3.0] - 2026-11-04
### Ajouté
- Module notifications connecté à PostgreSQL (lecture/écriture réelle)

### Modifié
- backend/src/modules/notifications.js
- package.json et backend/src/index.js (version)

### Notes
- Nécessite une base PostgreSQL avec les migrations appliquées.
- Aucun test d’exécution réelle avec PostgreSQL dans le sandbox.

## [2.2.0] - 2026-11-04
### Ajouté
- Module stocks connecté à PostgreSQL
\n## Tableau de bord officiel — première intégration\n- Intégration du HTML fourni comme frontend officiel.\n- Connexion des indicateurs élèves, enseignants, classes, notes, présences et paiements aux endpoints existants.\n- Retrait des chiffres et activités de démonstration non sourcés.\n

## v2.3.2 — Vues métier progressives
- Navigation latérale reliée à des vues applicatives pour Élèves, Enseignants, Classes, Notes, Présences et Paiements.
- Listes chargées depuis les endpoints GET existants et formulaires de création reliés aux endpoints POST existants.
- Messages, bibliothèque, cantine, transport, rapports et paramètres affichent explicitement leur statut « À intégrer » au lieu de simuler une fonctionnalité.
- Les erreurs API sont affichées dans la vue concernée ; aucune donnée fictive n'est injectée.
- Validation JavaScript syntaxique effectuée avec `node --check`. Tests PostgreSQL/API en environnement configuré encore nécessaires.


## v2.3.3 — Gestion des élèves (CRUD partiel)
- Ajout des routes API PUT et DELETE pour les élèves, avec filtrage par tenant.
- Réponses 400 pour identifiant invalide ou requête vide, 404 si l’élève est introuvable.
- Réponse 409 explicite si une contrainte de clé étrangère empêche la suppression.
- Ajout des actions Modifier et Supprimer dans la liste des élèves du frontend.
- La modification frontend porte sur prénom, nom et matricule ; les autres champs restent modifiables via l’API.
- Tests effectués : vérification syntaxique Node.js des fichiers JavaScript. Les tests PostgreSQL et les tests HTTP en environnement déployé restent à effectuer.

## v2.3.4 — Dossier individuel de l’élève
- Ajout de la migration `012_student_individual_records.sql` : affectation de classe et champs de profil (photo URL, adresse, téléphone d’urgence).
- Ajout de `GET /api/students/:id/profile` qui rassemble identité, classe, responsables, notes, présences et paiements en respectant le tenant courant.
- Ajout de l’ouverture du dossier depuis la liste des élèves et d’une sortie imprimable via le navigateur (Enregistrer au format PDF).
- Les historiques sans données restent affichés comme vides ; aucune donnée fictive n’est créée.
- La migration doit être appliquée à la base avant l’utilisation des nouveaux champs.
