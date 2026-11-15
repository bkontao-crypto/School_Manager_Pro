// Tests unitaires : aucun accès base de données ni réseau.  Lancer : npm test

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret-de-test-0123456789-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const jwt = require('../../backend/src/utils/jwt');
const password = require('../../backend/src/utils/password');
const { validate, isUuid, isRealDate } = require('../../backend/src/utils/validate');
const { rateLimit } = require('../../backend/src/middleware/security');
const { authenticate, requireAuth, requireRole, requireTenant, requireSuperAdmin } = require('../../backend/src/middleware/auth');
const config = require('../../backend/src/config');

const SECRET = 'secret-de-test-0123456789-0123456789';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

test('JWT : signe puis vérifie', () => {
  const t = jwt.sign({ sub: 'u1', role: 'admin' }, { secret: SECRET, ttlSeconds: 60 });
  const p = jwt.verify(t, { secret: SECRET });
  assert.equal(p.sub, 'u1');
  assert.equal(p.role, 'admin');
});

test('JWT : refuse une signature falsifiée, un autre secret, un jeton expiré', () => {
  const t = jwt.sign({ sub: 'u1', role: 'user' }, { secret: SECRET, ttlSeconds: 60 });
  const [h, , s] = t.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'u1', role: 'superadmin', exp: 9999999999 })).toString('base64url');
  assert.throws(() => jwt.verify(`${h}.${forgedBody}.${s}`, { secret: SECRET }), { code: 'invalid' });
  assert.throws(() => jwt.verify(t, { secret: 'autre-secret-autre-secret-autre-secret' }), { code: 'invalid' });
  const old = jwt.sign({ sub: 'u1' }, { secret: SECRET, ttlSeconds: 10, now: 1000 });
  assert.throws(() => jwt.verify(old, { secret: SECRET }), { code: 'expired' });
});

test('JWT : refuse alg=none et les jetons mal formés', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'x', role: 'superadmin', exp: 9999999999 })).toString('base64url');
  assert.throws(() => jwt.verify(`${header}.${body}.`, { secret: SECRET }), { code: 'invalid' });
  for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', undefined, null, 42]) {
    assert.throws(() => jwt.verify(bad, { secret: SECRET }), { code: 'invalid' });
  }
});

test('Mot de passe : hachage scrypt vérifiable, sel aléatoire, refus du mauvais mot de passe', async () => {
  const h1 = await password.hash('mot-de-passe-solide');
  const h2 = await password.hash('mot-de-passe-solide');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(await password.verify('mot-de-passe-solide', h1), true);
  assert.equal(await password.verify('mauvais', h1), false);
  assert.equal(await password.verify('x', 'pas-un-hash'), false);
  assert.equal(await password.verify('x', null), false);
  assert.ok(password.checkStrength('court'));
  assert.equal(password.checkStrength('assez-long-1'), null);
});

test('Validation : types, bornes, valeurs par défaut et champs vides', () => {
  const spec = {
    name: { type: 'string', required: true, max: 5 },
    age: { type: 'int', min: 0, max: 150 },
    note: { type: 'number', min: 0, max: 20, required: true },
    coef: { type: 'number', exclusiveMin: 0, default: 1 },
    sex: { type: 'enum', values: ['M', 'F'], nullable: true },
    when: { type: 'date' },
    web: { type: 'url', nullable: true },
    tags: { type: 'stringArray', maxItems: 2 },
    ref: { type: 'uuid', nullable: true }
  };
  let r = validate({ name: ' Ali ', note: '14,5' }, spec);
  assert.deepEqual(r.errors, []);
  assert.equal(r.values.name, 'Ali');
  assert.equal(r.values.note, 14.5);
  assert.equal(r.values.coef, 1);

  r = validate({ name: 'trop long', note: 21, age: 1.5, sex: 'X', when: '2026-02-30', web: 'javascript:alert(1)', tags: ['a', 'b', 'c'], ref: 'pas-uuid' }, spec);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['age', 'name', 'note', 'ref', 'sex', 'tags', 'web', 'when']);

  r = validate({ name: 'ok', note: 10, sex: '', ref: null }, spec);
  assert.equal(r.values.sex, null);
  assert.equal(r.values.ref, null);

  r = validate({}, spec);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['name', 'note']);

  // mise à jour partielle : un champ absent n'est ni exigé ni remplacé par sa valeur par défaut
  r = validate({ age: 10 }, spec, { partial: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.values, { age: 10 });

  // entrées qui ne sont pas des objets
  for (const body of [null, undefined, 'x', 5, [1, 2]]) assert.equal(validate(body, spec).errors.length, 2);
});

test('Validation : UUID et dates', () => {
  assert.equal(isUuid('00000000-0000-0000-0000-000000000001'), true); // UUID du seed, version 0
  assert.equal(isUuid('tenant-test-001'), false);
  assert.equal(isUuid("1' OR '1'='1"), false);
  assert.equal(isRealDate('2026-11-05'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('05/11/2026'), false);
});

test('Limitation de débit : bloque après le maximum puis renvoie Retry-After', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 3 });
  const req = { ip: '1.2.3.4' };
  let passed = 0;
  for (let i = 0; i < 3; i++) limiter(req, fakeRes(), () => { passed += 1; });
  assert.equal(passed, 3);
  const res = fakeRes();
  limiter(req, res, () => assert.fail('ne doit pas passer'));
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After']);
  const other = fakeRes();
  let ok = false;
  limiter({ ip: '9.9.9.9' }, other, () => { ok = true; });
  assert.equal(ok, true);
});

test('Auth : le tenant vient du jeton ; x-tenant-id est toujours ignoré (superadmin compris)', () => {
  const mk = (claims) => jwt.sign(claims, { secret: config.jwtSecret, ttlSeconds: 60 });

  const admin = { headers: { authorization: `Bearer ${mk({ sub: 'u', tid: A, role: 'admin' })}`, 'x-tenant-id': B } };
  authenticate(admin, fakeRes(), () => {});
  assert.equal(admin.tenantId, A);

  const sup = { headers: { authorization: `Bearer ${mk({ sub: 's', tid: null, role: 'superadmin' })}`, 'x-tenant-id': B } };
  authenticate(sup, fakeRes(), () => {});
  assert.equal(sup.tenantId, null); // le superadmin n'a pas d'établissement

  const supBad = { headers: { authorization: `Bearer ${mk({ sub: 's', tid: null, role: 'superadmin' })}`, 'x-tenant-id': "x'; DROP TABLE" } };
  authenticate(supBad, fakeRes(), () => {});
  assert.equal(supBad.tenantId, null);

  const anon = { headers: {} };
  authenticate(anon, fakeRes(), () => {});
  assert.equal(anon.user, undefined);
  const res = fakeRes();
  requireAuth(anon, res, () => assert.fail('doit refuser'));
  assert.equal(res.statusCode, 401);

  const garbage = { headers: { authorization: 'Bearer abc.def.ghi' } };
  authenticate(garbage, fakeRes(), () => {});
  const r2 = fakeRes();
  requireAuth(garbage, r2, () => assert.fail('doit refuser'));
  assert.equal(r2.statusCode, 401);
});

test('Auth : rôles et établissement requis', () => {
  const run = (mw, req) => { const res = fakeRes(); let passed = false; mw(req, res, () => { passed = true; }); return { passed, res }; };
  assert.equal(run(requireRole('admin'), { user: { role: 'admin' } }).passed, true);
  assert.equal(run(requireRole('admin'), { user: { role: 'superadmin' } }).res.statusCode, 403); // pas de passe-droit
  const denied = run(requireRole('admin'), { user: { role: 'teacher' } });
  assert.equal(denied.passed, false);
  assert.equal(denied.res.statusCode, 403);
  assert.equal(run(requireSuperAdmin, { user: { role: 'admin' } }).res.statusCode, 403);
  assert.equal(run(requireTenant, { tenantId: null, user: { role: 'admin' } }).res.statusCode, 400);
  const sup = run(requireTenant, { tenantId: null, user: { role: 'superadmin' } });
  assert.equal(sup.res.statusCode, 403);
  assert.equal(sup.passed, false);
  assert.equal(run(requireTenant, { tenantId: A, user: { role: 'admin' } }).passed, true);
});

test('Configuration : durée du jeton et secret de test', () => {
  assert.equal(config.jwtSecret, SECRET);
  assert.ok(config.jwtTtlSeconds > 0);
  assert.equal(typeof config.version, 'string');
  assert.ok(crypto.randomBytes(1));
});
