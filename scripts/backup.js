// Sauvegarde de la base : pg_dump compressé (gzip) dans ./backups, rotation automatique. Fonctionne sous Windows et Linux.
// Prérequis : l'outil « pg_dump » de PostgreSQL doit être dans le PATH (ou PG_DUMP_PATH vers l'exécutable).
// Usage :  npm run backup            (variables : DATABASE_URL, BACKUP_DIR=./backups, BACKUP_KEEP=14)
// Le mot de passe n'est jamais passé en ligne de commande (variable d'environnement du processus fils).

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

function pgEnv(urlString) {
  const u = new URL(urlString);
  return {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)), ...(process.env.DATABASE_SSL === 'true' ? { PGSSLMODE: 'require' } : {})
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL n’est pas défini.');
  const dir = path.resolve(process.env.BACKUP_DIR || 'backups');
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
  fs.mkdirSync(dir, { recursive: true });
  const env = pgEnv(process.env.DATABASE_URL);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(dir, `${env.PGDATABASE}_${stamp}.sql.gz`);
  const tmp = `${file}.partial`;

  const child = spawn(process.env.PG_DUMP_PATH || 'pg_dump', ['--no-owner', '--no-privileges', '--clean', '--if-exists'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('pg_dump introuvable : ajoutez le dossier « bin » de PostgreSQL au PATH ou définissez PG_DUMP_PATH.') : e));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump a échoué (code ${code}) : ${stderr.trim().slice(0, 300)}`))));
  });
  try {
    await Promise.all([pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(tmp)), exited]);
    fs.renameSync(tmp, file);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }

  const size = fs.statSync(file).size;
  if (size < 200) throw new Error('Sauvegarde suspecte (fichier presque vide).');
  console.log(`Sauvegarde créée : ${file} (${(size / 1024).toFixed(1)} Ko)`);

  const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${env.PGDATABASE}_`) && f.endsWith('.sql.gz')).sort().reverse().slice(keep);
  for (const f of old) { fs.rmSync(path.join(dir, f)); console.log(`Ancienne sauvegarde supprimée : ${f}`); }
}

main().catch((e) => { console.error(`Sauvegarde impossible : ${e.message}`); process.exit(1); });
