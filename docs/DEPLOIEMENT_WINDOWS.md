# Déploiement sous Windows — School Manager Pro

Guide pour installer l'application sur un PC ou serveur Windows (école, bureau). Non testé sous Windows lors de la livraison (développement sous Linux) : suivez les étapes et signalez toute différence.

## 1. Prérequis
1. **Node.js 18 ou plus récent** (version LTS) — https://nodejs.org
2. **PostgreSQL 13 ou plus récent** — https://www.postgresql.org/download/windows/ (retenir le mot de passe de l'utilisateur `postgres`, port 5432).
3. Ajouter au `PATH` le dossier `bin` de PostgreSQL (ex. `C:\Program Files\PostgreSQL\16\bin`) : nécessaire pour `npm run backup`.

## 2. Installation
Dans PowerShell, dans le dossier du projet (ex. `C:\school-manager-pro`) :
```powershell
npm install
Copy-Item .env.example .env
notepad .env
```
Créer la base (une fois) :
```powershell
psql -U postgres -c "CREATE DATABASE school_manager_pro;"
```
Renseigner dans `.env` :
- `DATABASE_URL=postgresql://postgres:MOT_DE_PASSE@localhost:5432/school_manager_pro`
- `NODE_ENV=production`
- `JWT_SECRET=` : générer avec `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` et coller le résultat.
- Pour les e-mails : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_URL` (voir `.env.example`).

Puis :
```powershell
npm run migrate
$env:NEW_USER_PASSWORD = "UnMotDePasseSolide-2026"
npm run create-user -- root@votre-domaine.ml superadmin
npm start
```
L'application répond sur http://localhost:3000. Ne pas utiliser `npm run seed` en production. Créez ensuite les établissements depuis l'espace « Plateforme ».

## 3. Démarrage automatique (service Windows)
Avec **NSSM** (https://nssm.cc) :
```powershell
nssm install SchoolManagerPro "C:\Program Files\nodejs\node.exe" "backend\src\index.js"
nssm set SchoolManagerPro AppDirectory C:\school-manager-pro
nssm set SchoolManagerPro AppStdout C:\school-manager-pro\logs\app.log
nssm set SchoolManagerPro AppStderr C:\school-manager-pro\logs\app.err.log
nssm start SchoolManagerPro
```
(créer le dossier `logs` avant). Alternative : PM2 (`npm i -g pm2 pm2-windows-startup`).

## 4. Accès depuis d'autres appareils / Internet
- Réseau local : ouvrir le port 3000 dans le pare-feu Windows (`New-NetFirewallRule -DisplayName "SMP" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`) ; accès par `http://IP-DU-PC:3000`.
- Internet : **toujours derrière HTTPS** (nginx, Caddy ou IIS en proxy inverse), avec `TRUST_PROXY=true`. Ne jamais exposer le port 3000 en HTTP simple : les mots de passe circuleraient en clair. Définir `APP_URL` avec l'adresse HTTPS publique.

## 5. Sauvegardes et mises à jour
Voir `docs/SAUVEGARDE_RESTAURATION.md` (planificateur de tâches Windows inclus). Mise à jour : sauvegarder → remplacer les fichiers → `npm install` → `npm run migrate` → redémarrer le service.

## 6. `package-lock.json`
Le fichier n'est pas fourni (génération impossible sans accès au registre npm lors de la livraison). Après le premier `npm install`, **conservez** le `package-lock.json` créé et versionnez-le : il fige les versions des dépendances. Pour installer ensuite à l'identique : `npm ci`.

## 7. Dépannage
| Symptôme | Cause probable |
|---|---|
| `ECONNREFUSED 5432` | Service PostgreSQL arrêté ou mauvais port dans `DATABASE_URL` |
| `JWT_SECRET` manquant au démarrage en production | Renseigner une valeur de 32 caractères minimum |
| `pg_dump introuvable` | Ajouter `...\PostgreSQL\16\bin` au `PATH` ou définir `PG_DUMP_PATH` |
| E-mails non envoyés | Écran « E-mails » (superadmin) : état de la configuration et journal avec la raison de l'échec |
| Écran blanc après mise à jour | Vider le cache du navigateur (le service worker est versionné) |
