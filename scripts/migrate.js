// Applique les migrations SQL de database/migrations dans l'ordre, une transaction par fichier.
// Usage : npm run migrate        (nécessite DATABASE_URL dans .env ou dans l'environnement)

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL manquant : copiez .env.example en .env et renseignez la connexion PostgreSQL.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });

  const migrationsDir = path.join(__dirname, '../database/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  console.log('Migrations trouvées :', files.length);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const check = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (check.rowCount > 0) {
        console.log(`Déjà appliquée : ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Application de : ${file}`);
      // Une transaction par fichier : en cas d'erreur, rien n'est appliqué de ce fichier.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      console.log(`OK : ${file}`);
    }
    console.log('Toutes les migrations ont été traitées.');
  } catch (err) {
    console.error('Erreur de migration :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
