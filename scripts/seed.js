// Données de démonstration : un établissement DEMO, un administrateur et un élève d'exemple.
// Usage : npm run seed            (refusé si NODE_ENV=production, sauf avec --force)
// Mot de passe de l'administrateur : variable SEED_ADMIN_PASSWORD, sinon généré et affiché UNE fois.

require('dotenv').config();
const crypto = require('node:crypto');
const db = require('../backend/src/utils/db');
const password = require('../backend/src/utils/password');

const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@demo.local';

async function seed() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refus : NODE_ENV=production. Utilisez scripts/create-user.js, ou ajoutez --force si vous savez ce que vous faites.');
    process.exit(1);
  }

  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const plain = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const problem = password.checkStrength(plain);
  if (problem) { console.error(problem); process.exit(1); }

  await db.query(
    `INSERT INTO tenants (id, code, name, status) VALUES ($1, 'DEMO', 'Établissement de démonstration', 'active')
     ON CONFLICT (code) DO NOTHING`,
    [DEMO_TENANT_ID]
  );
  const tenant = await db.query("SELECT id FROM tenants WHERE code = 'DEMO'");
  const tenantId = tenant.rows[0].id;

  const existing = await db.query('SELECT 1 FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, ADMIN_EMAIL]);
  if (existing.rowCount === 0) {
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'Administrateur Démo', 'admin')`,
      [tenantId, ADMIN_EMAIL, await password.hash(plain)]
    );
    console.log(`Administrateur créé : ${ADMIN_EMAIL} (établissement DEMO)`);
    if (generated) console.log(`Mot de passe généré (à noter maintenant, il ne sera plus affiché) : ${plain}`);
  } else {
    console.log(`Administrateur ${ADMIN_EMAIL} déjà présent : mot de passe inchangé.`);
  }

  await db.query(
    `INSERT INTO students (tenant_id, matricule, first_name, last_name) VALUES ($1, 'ELV001', 'Élève', 'Démo')
     ON CONFLICT (tenant_id, matricule) DO NOTHING`,
    [tenantId]
  );
  console.log('Seed terminé.');
}

seed()
  .catch((err) => { console.error('Erreur de seed :', err.message); process.exitCode = 1; })
  .finally(() => db.close());
