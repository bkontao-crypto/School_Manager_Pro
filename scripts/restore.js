// Restauration d'une sauvegarde créée par « npm run backup » dans la base de DATABASE_URL.
// DESTRUCTIF : les tables existantes sont remplacées. Exige --confirm. Prérequis : « psql » dans le PATH (ou PSQL_PATH).
// Usage :  node scripts/restore.js backups/school_manager_pro_2026-11-13-02-30.sql.gz --confirm

require('dotenv').config();
const fs = require('node:fs');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file || flag !== '--confirm') throw new Error('Usage : node scripts/restore.js <fichier.sql.gz> --confirm  (remplace le contenu de la base de DATABASE_URL)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL n’est pas défini.');
  if (!fs.existsSync(file)) throw new Error(`Fichier introuvable : ${file}`);
  const u = new URL(process.env.DATABASE_URL);
  const env = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
  console.log(`Restauration de ${file} dans la base « ${env.PGDATABASE} » sur ${env.PGHOST}…`);
  const child = spawn(process.env.PSQL_PATH || 'psql', ['-v', 'ON_ERROR_STOP=1', '-q'], { env: { ...process.env, ...env }, stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('psql introuvable : ajoutez le dossier « bin » de PostgreSQL au PATH ou définissez PSQL_PATH.') : e));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql a échoué (code ${code}).`))));
  });
  await Promise.all([pipeline(fs.createReadStream(file), zlib.createGunzip(), child.stdin), exited]);
  console.log('Restauration terminée. Redémarrez l’application.');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
