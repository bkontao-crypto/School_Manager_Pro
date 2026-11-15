// Configuration centrale, lue depuis l'environnement (.env via dotenv).
// Aucune valeur secrète n'est codée en dur : en production, un secret JWT absent ou faible arrête le démarrage.

require('dotenv').config();
const crypto = require('node:crypto');
const pkg = require('../../package.json');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function parseDuration(value, fallbackSeconds) {
  const m = String(value || '').trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return fallbackSeconds;
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[(m[2] || 's').toLowerCase()];
  return Number(m[1]) * unit;
}

function list(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

let jwtSecret = env.JWT_SECRET;
const placeholder = !jwtSecret || jwtSecret === 'change_me_in_production';
if (isProd && (placeholder || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET doit être défini avec au moins 32 caractères en production (NODE_ENV=production).');
}
if (placeholder) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  if (env.NODE_ENV !== 'test') {
    console.warn('[config] JWT_SECRET absent : secret temporaire généré. Les sessions seront perdues à chaque redémarrage.');
  }
}

module.exports = {
  isProd,
  version: pkg.version,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL || '',
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret,
  jwtTtlSeconds: parseDuration(env.JWT_EXPIRES_IN, 8 * 3600),
  corsOrigins: list(env.CORS_ORIGINS),
  trustProxy: env.TRUST_PROXY === 'true',
  rateLimitApiPerMinute: Number(env.RATE_LIMIT_API_PER_MINUTE) || 600,
  loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS) || 10,
  loginWindowSeconds: Number(env.LOGIN_WINDOW_SECONDS) || 15 * 60
};
