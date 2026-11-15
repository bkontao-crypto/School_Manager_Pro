// JWT HS256 minimal, sans dépendance externe (node:crypto uniquement).
// L'algorithme est imposé à HS256 : un jeton "alg: none" ou RS256 est refusé.

const crypto = require('node:crypto');

const b64u = (input) => Buffer.from(input).toString('base64url');

function signature(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function sign(payload, { secret, ttlSeconds, now = Math.floor(Date.now() / 1000) }) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const data = `${header}.${body}`;
  return `${data}.${b64u(signature(data, secret))}`;
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function verify(token, { secret, now = Math.floor(Date.now() / 1000) }) {
  if (typeof token !== 'string') throw fail('invalid', 'Jeton absent');
  const parts = token.split('.');
  if (parts.length !== 3) throw fail('invalid', 'Jeton mal formé');
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    throw fail('invalid', 'Jeton illisible');
  }
  if (!header || header.alg !== 'HS256') throw fail('invalid', 'Algorithme non autorisé');
  const expected = signature(`${parts[0]}.${parts[1]}`, secret);
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw fail('invalid', 'Signature invalide');
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) throw fail('expired', 'Jeton expiré');
  return payload;
}

module.exports = { sign, verify };
