// Accès PostgreSQL : pool paresseux (créé à la première requête), transactions, fermeture propre.

const { Pool, types } = require('pg');
const config = require('../config');

// DATE -> chaîne "YYYY-MM-DD" (évite le décalage de fuseau d'un objet Date) ; BIGINT (count) -> nombre.
if (types && types.setTypeParser) {
  types.setTypeParser(1082, (v) => v);
  types.setTypeParser(20, (v) => parseInt(v, 10));
}

let pool;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL manquant : copiez .env.example en .env et renseignez la connexion PostgreSQL.');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000
    });
    pool.on('error', (err) => console.error('[db] erreur sur une connexion inactive :', err.message));
  }
  return pool;
}

function query(sql, params) {
  return getPool().query(sql, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

module.exports = { query, withTransaction, getPool, close };
