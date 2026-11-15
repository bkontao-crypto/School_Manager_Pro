# SCHOOL MANAGER PRO
ERP scolaire multi-établissements (Node.js, Express, PostgreSQL, interface web installable PWA).

**Version 2.22.0** — voir `docs/CHANGELOG.md`. Suivi des corrections : `docs/AUDIT_SUIVI.md`. Feuille de route : `docs/ROADMAP_SUIVI.md`.

## Démarrage rapide (Windows, macOS, Linux)
Prérequis : Node.js 18+, PostgreSQL 13+.

```bash
npm install
cp .env.example .env              # puis renseigner DATABASE_URL et JWT_SECRET
npm run migrate                   # applique database/migrations/001 à 025
npm run seed                      # établissement DEMO + admin@demo.local (mot de passe affiché une seule fois)
npm run build:css                 # génère frontend/styles/tailwind.css (déjà fourni dans le ZIP)
npm start                         # http://localhost:3000
```

Créer un compte : `npm run create-user -- directeur@ecole.ml admin CODE_ETABLISSEMENT "Nom Prénom"`
(pour un superadmin : `... superadmin`, sans code d'établissement). Le mot de passe est généré et affiché une fois, ou lu dans `NEW_USER_PASSWORD`.

Générer un secret de jeton : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## Tests
```bash
npm test                                            # unitaires, sans base
TEST_DATABASE_URL=postgresql://…/school_manager_pro_test npm run test:integration
```
La base de test doit se terminer par `_test` : son schéma est effacé à chaque exécution.

## Sécurité en bref
- Jeton JWT obligatoire sur toute l'API ; l'établissement vient du jeton, jamais d'un paramètre client.
- Facturation des abonnements, identité (nom, slogan, logo), e-mails et rappels : voir `docs/CHANGELOG.md` (2.10.0 et 2.11.0). Paiement en ligne : **indisponible** pour le moment.
- E-mails (facture, rappels, mot de passe oublié) : renseigner `SMTP_*`, `MAIL_FROM`, `APP_URL` dans `.env` ; sans cela, l'application fonctionne mais n'envoie rien.
- Permissions : Paramètres → « Permissions par module » (aucun accès / lecture / lecture et modification, par rôle). L'administrateur a toujours tous les droits.
- Sauvegarde : `npm run backup` ; restauration : `npm run restore` (voir `docs/SAUVEGARDE_RESTAURATION.md`). Windows : `docs/DEPLOIEMENT_WINDOWS.md`.
- Superadmin : se connecte sans code d'établissement et accède à l'espace « Plateforme » (établissements, packs, licences, quotas, suspension). Il ne voit jamais les données privées des écoles.
- Rôles : `superadmin`, `admin`, `teacher`, `accountant`, `user` (écritures limitées par module).
- CSP stricte : aucun script, style, police ou image externe. Rien n'est chargé depuis un CDN.
- Derrière un proxy (nginx, hébergeur) : `TRUST_PROXY=true` et HTTPS en frontal.
- Les réponses de l'API ne sont jamais mises en cache par le service worker.

## Structure
```
backend/src/     config, utils (jwt, mot de passe, validation, http, db), middleware, modules métier
database/        migrations SQL (001-025)
frontend/        index.html, app.js, styles/, assets/ (polices, icônes, images locales)
pwa/             manifest.json, service-worker.js, icons/
scripts/         migrate, seed, create-user, build-css, backup, restore
tests/           unit/ et integration/
docs/            architecture, modèle de données, suivi
```

## Limites connues
Voir `docs/AUDIT_SUIVI.md` (section « Reste à faire »).
