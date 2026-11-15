# Sauvegarde et restauration — School Manager Pro

La base PostgreSQL contient toutes les données (élèves, notes, paiements, factures…). **Sans sauvegarde testée, il n'y a pas de sécurité.** Deux scripts fournis fonctionnent sous Windows, Linux et macOS ; ils s'appuient sur les outils `pg_dump` et `psql` de PostgreSQL.

## Sauvegarder
```bash
npm run backup
```
- Crée `backups/<base>_AAAA-MM-JJ-HH-MM.sql.gz` (dump SQL compressé, sans propriétaires ni droits, avec `DROP … IF EXISTS` pour une restauration propre).
- Garde les 14 dernières sauvegardes (`BACKUP_KEEP`), dans `./backups` (`BACKUP_DIR`).
- Le mot de passe de la base n'apparaît jamais dans la ligne de commande.
- Si `pg_dump` n'est pas trouvé : ajouter le dossier `bin` de PostgreSQL au `PATH` (Windows : `C:\Program Files\PostgreSQL\16\bin`) ou définir `PG_DUMP_PATH`.

### Automatiser
- **Windows** : Planificateur de tâches → créer une tâche quotidienne (ex. 02 h 00), action « Démarrer un programme » : `cmd` ; arguments : `/c cd /d C:\school-manager-pro && npm run backup >> backups\backup.log 2>&1`.
- **Linux** : `0 2 * * * cd /opt/school-manager-pro && npm run backup >> backups/backup.log 2>&1` (crontab).

### Règle des trois copies
Copiez régulièrement le dossier `backups` **hors du serveur** (disque externe, autre machine, stockage en ligne). Une sauvegarde qui se trouve sur la même machine ne protège pas d'un vol, d'un incendie ou d'une panne de disque. Les sauvegardes contiennent des données d'élèves mineurs : stockez-les chiffrées ou dans un endroit à accès restreint.

## Restaurer
La restauration **remplace** le contenu de la base visée par `DATABASE_URL`.
1. Arrêter l'application.
2. Idéalement, restaurer dans une base vide :
   ```sql
   CREATE DATABASE school_manager_pro_restore;
   ```
   puis pointer `DATABASE_URL` vers elle (ou, pour remplacer la base actuelle, faire d'abord une sauvegarde de l'état actuel).
3. Lancer :
   ```bash
   node scripts/restore.js backups/school_manager_pro_2026-11-13-02-30.sql.gz --confirm
   ```
   Le drapeau `--confirm` est obligatoire ; le script s'arrête à la première erreur SQL.
4. Redémarrer l'application et vérifier : connexion, nombre d'élèves, dernières factures.

## Vérifier vos sauvegardes
Une fois par mois, restaurez la dernière sauvegarde dans une base de test et comparez quelques chiffres (élèves, utilisateurs, factures). Vérifié lors de la livraison 2.11.0 : sauvegarde d'une base de démonstration puis restauration dans une base vierge → mêmes effectifs (14 élèves, 4 utilisateurs, 3 factures, 5 e-mails journalisés).

## Mise à jour du logiciel
Toujours : `npm run backup` → remplacer les fichiers → `npm install` → `npm run migrate` → redémarrer. Les migrations ne suppriment pas de données ; la 013 s'arrête s'il reste des lignes sans établissement.

## Limites
- Sauvegarde logique complète (pas incrémentale) : adaptée à la taille d'un établissement ou d'un groupe scolaire ; au-delà, utiliser la sauvegarde continue de PostgreSQL (WAL).
- Les fichiers ne sont pas dans des dossiers : logos et affiches sont stockés dans la base, donc inclus dans la sauvegarde.
- Non testé sous Windows ici (Linux uniquement) : la première exécution sur votre machine est à vérifier.
