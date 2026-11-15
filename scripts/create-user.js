// Crée un utilisateur (utilisable en production, contrairement au seed).
// Usage :
//   node scripts/create-user.js <email> <role> [codeEtablissement] [nom complet]
//   - superadmin : pas de code d'établissement ; tous les autres rôles en exigent un.
//   - le mot de passe est lu dans la variable NEW_USER_PASSWORD, sinon généré et affiché une seule fois.
// Exemple : NEW_USER_PASSWORD='un-mot-de-passe-solide' node scripts/create-user.js directeur@ecole.ml admin ECOLE1 "Awa Traoré"

require('dotenv').config();
const crypto = require('node:crypto');
const db = require('../backend/src/utils/db');
const password = require('../backend/src/utils/password');

const ROLES = ['superadmin', 'admin', 'teacher', 'accountant', 'staff', 'parent', 'user'];

async function main() {
  const [email, role, code, ...nameParts] = process.argv.slice(2);
  if (!email || !role || !ROLES.includes(role)) {
    console.error(`Usage : node scripts/create-user.js <email> <role> [codeEtablissement] [nom complet]\nRôles : ${ROLES.join(', ')}`);
    process.exit(1);
  }
  if (role !== 'superadmin' && !code) {
    console.error('Le code de l’établissement est obligatoire pour ce rôle.');
    process.exit(1);
  }
  const generated = !process.env.NEW_USER_PASSWORD;
  const plain = process.env.NEW_USER_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const problem = password.checkStrength(plain);
  if (problem) { console.error(problem); process.exit(1); }

  let tenantId = null;
  if (role !== 'superadmin') {
    const t = await db.query('SELECT id FROM tenants WHERE upper(code) = upper($1)', [code]);
    if (t.rowCount === 0) { console.error(`Établissement introuvable : ${code}`); process.exit(1); }
    tenantId = t.rows[0].id;
  }
  await db.query(
    'INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)',
    [tenantId, email.trim(), await password.hash(plain), nameParts.join(' ') || null, role]
  );
  console.log(`Utilisateur créé : ${email} (${role}${code ? `, ${code}` : ''})`);
  if (generated) console.log(`Mot de passe généré (à noter maintenant) : ${plain}`);
}

main()
  .catch((err) => {
    console.error('Erreur :', err.code === '23505' ? 'cet e-mail existe déjà pour cet établissement.' : err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
