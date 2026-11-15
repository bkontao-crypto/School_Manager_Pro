// Hachage des mots de passe avec scrypt (node:crypto), format : scrypt$N$r$p$sel$hash (base64url).

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

async function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verify(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expected] = parts;
  const expectedBuf = Buffer.from(expected, 'base64url');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64url'), expectedBuf.length,
    { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expectedBuf.length && crypto.timingSafeEqual(key, expectedBuf);
}

// Hash factice, calculé une fois : permet de dépenser le même temps quand l'utilisateur n'existe pas.
let dummy;
async function dummyVerify(password) {
  if (!dummy) dummy = await hash('dummy-password-for-timing');
  await verify(password, dummy);
  return false;
}

function checkStrength(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (password.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

module.exports = { hash, verify, dummyVerify, checkStrength };
