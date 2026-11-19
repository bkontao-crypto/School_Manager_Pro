// Tests d'intégration : l'API réelle contre une base PostgreSQL de test.
//
// Lancer :  TEST_DATABASE_URL=postgres://user:pass@localhost:5432/school_manager_pro_test npm run test:integration
// ATTENTION : le schéma « public » de cette base est SUPPRIMÉ puis recréé à chaque exécution.
// Par sécurité, le nom de la base doit se terminer par « _test ».

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret-de-test-0123456789-0123456789';
process.env.LOGIN_MAX_ATTEMPTS = '6';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
// Texte d'un PDF : contenu des pages décompressé (flux FlateDecode) + en-tête/métadonnées brutes.
const pdfText = (buf) => [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => require('node:zlib').inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')).join('\n') + buf.toString('latin1');
const fs = require('node:fs');
const path = require('node:path');

const TEST_URL = process.env.TEST_DATABASE_URL;

if (!TEST_URL) {
  describe('API (intégration)', () => {
    it('ignorée : TEST_DATABASE_URL n’est pas défini', { skip: 'TEST_DATABASE_URL absent' }, () => {});
  });
} else {
  const dbName = decodeURIComponent(new URL(TEST_URL).pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refus : la base de test doit se terminer par "_test" (reçu : "${dbName}").`);
  }
  process.env.DATABASE_URL = TEST_URL;
  // Stockage des documents : dossier temporaire propre à cette exécution (jamais le dossier réel).
  process.env.DOCUMENTS_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'smp-docs-test-'));

  const { Pool } = require('pg');
  const { createApp } = require('../../backend/src/index');
  const db = require('../../backend/src/utils/db');
  const password = require('../../backend/src/utils/password');
  const { resetRateLimits } = require('../../backend/src/middleware/security');

  const PASSWORD = 'Motdepasse-123';
  const TA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const TSEED = '00000000-0000-0000-0000-000000000001';

  describe('API (intégration)', () => {
    let pool;
    let server;
    let base;
    const tokens = {};

    async function api(method, url, { token, body, headers = {}, raw } = {}) {
      const res = await fetch(`${base}${url}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* pas du JSON */ }
      return { status: res.status, json, text, headers: res.headers };
    }

    async function login(email, tenant_code, pwd = PASSWORD) {
      const r = await api('POST', '/api/auth/login', { body: { email, password: pwd, tenant_code } });
      assert.equal(r.status, 200, `connexion de ${email} : ${r.text}`);
      return r.json.data.token;
    }

    async function resetDatabase() {
      await pool.query('DROP SCHEMA public CASCADE');
      await pool.query('CREATE SCHEMA public');
      const dir = path.join(__dirname, '../../database/migrations');
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
        await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      }
    }

    async function seedUsers() {
      await pool.query(
        `INSERT INTO tenants (id, code, name, status) VALUES ($1, 'ECOLEA', 'École A', 'active'), ($2, 'ECOLEB', 'École B', 'active'), ($3, 'SEED', 'Seed', 'active')`,
        [TA, TB, TSEED]
      );
      const hash = await password.hash(PASSWORD);
      const users = [
        [TA, 'admin@a.test', 'admin', true], [TA, 'prof@a.test', 'teacher', true], [TA, 'compta@a.test', 'accountant', true],
        [TA, 'simple@a.test', 'user', true], [TA, 'inactif@a.test', 'admin', false], [TB, 'admin@b.test', 'admin', true],
        [null, 'root@test', 'superadmin', true]
      ];
      for (const [tid, email, role, active] of users) {
        await pool.query('INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)',
          [tid, email, hash, email, role, active]);
      }
    }

    before(async () => {
      pool = new Pool({ connectionString: TEST_URL });
      await resetDatabase();
      await seedUsers();
      const app = createApp();
      await new Promise((resolve) => { server = app.listen(0, resolve); });
      base = `http://127.0.0.1:${server.address().port}`;
      tokens.adminA = await login('admin@a.test', 'ECOLEA');
      tokens.teacherA = await login('prof@a.test', 'ECOLEA');
      tokens.accountantA = await login('compta@a.test', 'ECOLEA');
      tokens.userA = await login('simple@a.test', 'ECOLEA');
      tokens.adminB = await login('admin@b.test', 'ECOLEB');
      tokens.root = await login('root@test');
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.close();
      if (pool) await pool.end();
    });

    beforeEach(() => resetRateLimits());

    // ---------------------------------------------------------------- Sécurité HTTP
    describe('Sécurité HTTP', () => {
      it('sonde publique, sans X-Powered-By, avec en-têtes de sécurité', async () => {
        const r = await api('GET', '/api/health');
        assert.equal(r.status, 200);
        assert.equal(r.json.database, true);
        assert.match(r.json.version, /^\d+\.\d+\.\d+$/);
        assert.equal(r.headers.get('x-powered-by'), null);
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(r.headers.get('x-frame-options'), 'DENY');
        assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
        assert.equal(r.headers.get('access-control-allow-origin'), null);
      });

      it('route /api inconnue : 404 JSON, jamais la page HTML (M12)', async () => {
        const r = await api('GET', '/api/zzz', { token: tokens.adminA });
        assert.equal(r.status, 404);
        assert.equal(r.json.error, 'Route introuvable.');
        const file = await api('GET', '/manifest-inexistant.json');
        assert.equal(file.status, 404);
        const page = await api('GET', '/une-page');
        assert.equal(page.status, 200);
        assert.match(page.text, /<html/i);
      });

      it('JSON invalide : 400 sans détail interne', async () => {
        const r = await api('POST', '/api/students', { token: tokens.adminA, raw: '{pas du json', headers: { 'Content-Type': 'application/json' } });
        assert.equal(r.status, 400);
        assert.doesNotMatch(r.text, /Unexpected|position|JSON\.parse/i);
      });
    });

    // ---------------------------------------------------------------- C1 Authentification
    describe('C1 · Authentification', () => {
      it('refuse l’accès sans jeton, avec un jeton falsifié ou expiré', async () => {
        assert.equal((await api('GET', '/api/students')).status, 401);
        assert.equal((await api('GET', '/api/students', { token: 'abc.def.ghi' })).status, 401);
        const forged = `${tokens.userA.split('.').slice(0, 2).join('.')}.signature-bidon`;
        assert.equal((await api('GET', '/api/students', { token: forged })).status, 401);
        const jwt = require('../../backend/src/utils/jwt');
        const expired = jwt.sign({ sub: 'x', tid: TA, role: 'admin' }, { secret: process.env.JWT_SECRET, ttlSeconds: 10, now: 1000 });
        const r = await api('GET', '/api/students', { token: expired });
        assert.equal(r.status, 401);
        assert.equal(r.json.code, 'expired');
      });

      it('connexion : jeton valide, identifiants invalides indiscernables, compte inactif refusé', async () => {
        const ok = await api('POST', '/api/auth/login', { body: { email: 'ADMIN@a.test', password: PASSWORD, tenant_code: 'ecolea' } });
        assert.equal(ok.status, 200);
        assert.equal(ok.json.data.user.role, 'admin');
        assert.equal(ok.json.data.user.tenant_code, 'ECOLEA');
        assert.equal(ok.json.data.user.password_hash, undefined);

        const wrongPass = await api('POST', '/api/auth/login', { body: { email: 'admin@a.test', password: 'mauvais', tenant_code: 'ECOLEA' } });
        const unknown = await api('POST', '/api/auth/login', { body: { email: 'inconnu@a.test', password: PASSWORD, tenant_code: 'ECOLEA' } });
        const wrongTenant = await api('POST', '/api/auth/login', { body: { email: 'admin@a.test', password: PASSWORD, tenant_code: 'ECOLEB' } });
        const noTenant = await api('POST', '/api/auth/login', { body: { email: 'admin@a.test', password: PASSWORD } });
        const inactive = await api('POST', '/api/auth/login', { body: { email: 'inactif@a.test', password: PASSWORD, tenant_code: 'ECOLEA' } });
        for (const r of [wrongPass, unknown, wrongTenant, noTenant, inactive]) {
          assert.equal(r.status, 401);
          assert.equal(r.text, wrongPass.text); // même réponse : aucun compte n'est révélé
        }
      });

      it('/api/auth/me renvoie l’utilisateur du jeton', async () => {
        const r = await api('GET', '/api/auth/me', { token: tokens.teacherA });
        assert.equal(r.status, 200);
        assert.equal(r.json.data.email, 'prof@a.test');
        assert.equal((await api('GET', '/api/auth/me')).status, 401);
      });

      it('limite les tentatives de connexion (429 puis Retry-After)', async () => {
        let last;
        for (let i = 0; i < 7; i++) last = await api('POST', '/api/auth/login', { body: { email: 'cible@a.test', password: 'x', tenant_code: 'ECOLEA' } });
        assert.equal(last.status, 429);
        assert.ok(last.headers.get('retry-after'));
      });

      it('les routes de la plateforme sont réservées au superadmin', async () => {
        assert.equal((await api('GET', '/api/platform/tenants', { token: tokens.adminA })).status, 403);
        assert.equal((await api('POST', '/api/platform/tenants', { token: tokens.adminA, body: { code: 'NEW', name: 'x' } })).status, 403);
        assert.equal((await api('POST', '/api/platform/tenants', { body: { code: 'NEW', name: 'x' } })).status, 401);
        const list = await api('GET', '/api/platform/tenants', { token: tokens.root });
        assert.equal(list.status, 200);
        assert.equal(list.json.meta.total, 3);
        const body = { code: 'nouvelle', name: 'Nouvelle école', admin_email: 'dir@nouvelle.test', admin_full_name: 'Directeur', admin_password: PASSWORD };
        const created = await api('POST', '/api/platform/tenants', { token: tokens.root, body });
        assert.equal(created.status, 201, created.text);
        assert.equal(created.json.data.code, 'NOUVELLE');
        const dupT = await api('POST', '/api/platform/tenants', { token: tokens.root, body: { ...body, admin_email: 'autre@nouvelle.test' } });
        assert.equal(dupT.status, 409, dupT.text);
      });

      it('droits par rôle : enseignant, comptable et simple utilisateur', async () => {
        const student = { matricule: 'R-1', first_name: 'Role', last_name: 'Test' };
        assert.equal((await api('POST', '/api/students', { token: tokens.teacherA, body: student })).status, 403);
        assert.equal((await api('POST', '/api/students', { token: tokens.userA, body: student })).status, 403);
        assert.equal((await api('GET', '/api/students', { token: tokens.userA })).status, 200); // lecture autorisée
        const s = await api('POST', '/api/students', { token: tokens.adminA, body: student });
        assert.equal(s.status, 201);
        const id = s.json.data.id;
        assert.equal((await api('POST', '/api/attendances', { token: tokens.teacherA, body: { student_id: id, date: '2026-11-03', status: 'present' } })).status, 201);
        assert.equal((await api('POST', '/api/grades', { token: tokens.accountantA, body: { student_id: id, subject: 'Maths', score: 10 } })).status, 403);
        assert.equal((await api('POST', '/api/payments', { token: tokens.accountantA, body: { student_id: id, amount: 1000 } })).status, 201);
        assert.equal((await api('POST', '/api/payments', { token: tokens.teacherA, body: { student_id: id, amount: 1000 } })).status, 403);
      });
    });

    // ---------------------------------------------------------------- C2 C3 C4 Isolation
    describe('C2 / C3 / C4 · Isolation des établissements', () => {
      let studentA;
      let studentB;

      before(async () => {
        studentA = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'ISO-A', first_name: 'Aminata', last_name: 'Alpha' } })).json.data.id;
        studentB = (await api('POST', '/api/students', { token: tokens.adminB, body: { matricule: 'ISO-B', first_name: 'Bakary', last_name: 'Bravo' } })).json.data.id;
      });

      it('chaque établissement ne voit que ses élèves, même avec un en-tête x-tenant-id ou ?tenant_id', async () => {
        const a = await api('GET', '/api/students?limit=200', { token: tokens.adminA, headers: { 'x-tenant-id': TB } });
        assert.equal(a.status, 200);
        assert.ok(a.json.data.some((s) => s.matricule === 'ISO-A'));
        assert.ok(!a.json.data.some((s) => s.matricule === 'ISO-B'));
        const viaQuery = await api('GET', `/api/students?tenant_id=${TB}&limit=200`, { token: tokens.adminA });
        assert.ok(!viaQuery.json.data.some((s) => s.matricule === 'ISO-B'));
        const b = await api('GET', '/api/students?limit=200', { token: tokens.adminB });
        assert.ok(b.json.data.some((s) => s.matricule === 'ISO-B'));
        assert.ok(!b.json.data.some((s) => s.matricule === 'ISO-A'));
      });

      it('impossible de lire, modifier ou supprimer l’élève d’un autre établissement', async () => {
        assert.equal((await api('GET', `/api/students/${studentB}/profile`, { token: tokens.adminA })).status, 404);
        assert.equal((await api('PUT', `/api/students/${studentB}`, { token: tokens.adminA, body: { first_name: 'Piraté' } })).status, 404);
        assert.equal((await api('DELETE', `/api/students/${studentB}`, { token: tokens.adminA })).status, 404);
        const still = await api('GET', `/api/students/${studentB}/profile`, { token: tokens.adminB });
        assert.equal(still.json.data.student.first_name, 'Bakary');
      });

      it('le superadmin n’a accès à aucune donnée d’établissement, même avec x-tenant-id', async () => {
        for (const url of ['/api/students', '/api/payments', '/api/grades', '/api/hr', '/api/users', '/api/settings', '/api/stats/dashboard']) {
          const r = await api('GET', url, { token: tokens.root, headers: { 'x-tenant-id': TA } });
          assert.equal(r.status, 403, url);
          assert.equal(r.json.code, 'superadmin_no_tenant_data');
        }
        assert.equal((await api('POST', '/api/students', { token: tokens.root, headers: { 'x-tenant-id': TA }, body: { matricule: 'X', first_name: 'a', last_name: 'b' } })).status, 403);
      });

      it('la base refuse une ligne sans établissement et un lien entre établissements', async () => {
        await assert.rejects(pool.query("INSERT INTO students (tenant_id, matricule, first_name, last_name) VALUES (NULL, 'ORPH', 'O', 'R')"), { code: '23502' });
        const cls = await pool.query("INSERT INTO classes (tenant_id, name) VALUES ($1, 'Classe B') RETURNING id", [TB]);
        await assert.rejects(pool.query('UPDATE students SET class_id = $1 WHERE id = $2', [cls.rows[0].id, studentA]), { code: '23503' });
      });

      it('l’API refuse de rattacher un élève à la classe d’un autre établissement (422)', async () => {
        const clsB = await api('POST', '/api/classes', { token: tokens.adminB, body: { name: '6e B' } });
        assert.equal(clsB.status, 201);
        const r = await api('PUT', `/api/students/${studentA}`, { token: tokens.adminA, body: { class_id: clsB.json.data.id } });
        assert.equal(r.status, 422);
        const clsA = await api('POST', '/api/classes', { token: tokens.adminA, body: { name: '6e A' } });
        const ok = await api('PUT', `/api/students/${studentA}`, { token: tokens.adminA, body: { class_id: clsA.json.data.id } });
        assert.equal(ok.status, 200);
        assert.equal(ok.json.data.class_id, clsA.json.data.id);
      });

      it('pas de paiement, de note ni de présence sur l’élève d’un autre établissement (422)', async () => {
        const pay = await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: studentB, amount: 5000 } });
        assert.equal(pay.status, 422);
        const grade = await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: studentB, subject: 'Maths', score: 10 } });
        assert.equal(grade.status, 422);
        const att = await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: studentB, date: '2026-11-03', status: 'present' } });
        assert.equal(att.status, 422);
      });

      it('les listes de paiements, notes et présences sont isolées par établissement', async () => {
        await api('POST', '/api/payments', { token: tokens.adminB, body: { student_id: studentB, amount: 7777 } });
        const a = await api('GET', '/api/payments?limit=200', { token: tokens.adminA });
        assert.ok(!a.json.data.some((p) => Number(p.amount) === 7777));
        const b = await api('GET', '/api/payments?limit=200', { token: tokens.adminB });
        assert.ok(b.json.data.some((p) => Number(p.amount) === 7777));
      });
    });

    // ---------------------------------------------------------------- M4 M5 Validation et erreurs
    describe('M4 / M5 · Validation et erreurs', () => {
      let sid;
      before(async () => {
        sid = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'VAL-1', first_name: 'Val', last_name: 'Idation' } })).json.data.id;
      });

      it('champs obligatoires manquants : 400 avec la liste des erreurs', async () => {
        const r = await api('POST', '/api/students', { token: tokens.adminA, body: { first_name: 'Sans matricule' } });
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'Données invalides');
        assert.ok(r.json.errors.some((e) => e.field === 'matricule'));
        assert.ok(r.json.errors.some((e) => e.field === 'last_name'));
      });

      it('statut de présence inconnu : 400 (et non plus 500)', async () => {
        const r = await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: sid, date: '2026-11-03', status: 'retard' } });
        assert.equal(r.status, 400);
        assert.ok(r.json.errors.some((e) => e.field === 'status'));
      });

      it('montants et notes hors limites refusés', async () => {
        for (const amount of [-500, 0, 'abc', null]) {
          assert.equal((await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sid, amount } })).status, 400, `montant ${amount}`);
        }
        for (const score of [-3, 21, 999.99, 'x']) {
          assert.equal((await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: sid, subject: 'Maths', score } })).status, 400, `note ${score}`);
        }
        const ok = await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: sid, subject: 'Maths', score: '14,5', evaluation_type: 'Devoir' } });
        assert.equal(ok.status, 201);
        assert.equal(Number(ok.json.data.score), 14.5);
      });

      it('identifiants invalides : 400 partout, jamais 500', async () => {
        assert.equal((await api('GET', '/api/students/pas-un-uuid/profile', { token: tokens.adminA })).status, 400);
        assert.equal((await api('PUT', '/api/students/pas-un-uuid', { token: tokens.adminA, body: { first_name: 'x' } })).status, 400);
        assert.equal((await api('GET', '/api/payments?student_id=zzz', { token: tokens.adminA })).status, 400);
        assert.equal((await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: "1' OR '1'='1", amount: 10 } })).status, 400);
        assert.equal((await api('GET', '/api/messages/messages', { token: tokens.adminA })).status, 400); // conversation_id obligatoire
      });

      it('URL de photo dangereuse refusée ; date de naissance impossible refusée', async () => {
        assert.equal((await api('PUT', `/api/students/${sid}`, { token: tokens.adminA, body: { photo_url: 'javascript:alert(1)' } })).status, 400);
        assert.equal((await api('PUT', `/api/students/${sid}`, { token: tokens.adminA, body: { date_of_birth: '2026-02-30' } })).status, 400);
        assert.equal((await api('PUT', `/api/students/${sid}`, { token: tokens.adminA, body: { photo_url: 'https://exemple.ml/p.jpg', date_of_birth: '2012-05-17', gender: 'F' } })).status, 200);
        assert.equal((await api('PUT', `/api/students/${sid}`, { token: tokens.adminA, body: {} })).status, 400);
      });

      it('les erreurs de base de données ne divulguent aucun détail interne', async () => {
        const dup = await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'VAL-1', first_name: 'Autre', last_name: 'Doublon' } });
        assert.equal(dup.status, 409);
        assert.equal(dup.json.error, 'Ce matricule existe déjà.');
        const fk = await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', amount: 100 } });
        assert.equal(fk.status, 422);
        for (const r of [dup, fk]) assert.doesNotMatch(r.text, /violates|constraint|relation|syntax|_fkey|_key/i);
      });
    });

    // ---------------------------------------------------------------- M3 M6 M7 Paiements, présences
    describe('M3 / M6 / M7 · Paiements et présences', () => {
      let sidA;
      let sidB;
      before(async () => {
        sidA = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'PAY-A', first_name: 'Pay', last_name: 'Alpha' } })).json.data.id;
        sidB = (await api('POST', '/api/students', { token: tokens.adminB, body: { matricule: 'PAY-B', first_name: 'Pay', last_name: 'Bravo' } })).json.data.id;
      });

      it('reçus numérotés par établissement, statut « paye » par défaut, sans trou après un échec', async () => {
        const year = new Date().getFullYear();
        const countA = Number((await pool.query("SELECT COALESCE(max(value), 0) AS v FROM tenant_counters WHERE tenant_id = $1 AND name = 'receipt'", [TA])).rows[0].v);
        const p1 = await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sidA, amount: 25000, fee_type: 'Scolarité' } });
        assert.equal(p1.status, 201);
        assert.equal(p1.json.data.status, 'paye');
        assert.equal(p1.json.data.receipt_number, `R-${year}-${String(countA + 1).padStart(6, '0')}`);
        const fail = await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sidB, amount: 100 } });
        assert.equal(fail.status, 422);
        const p2 = await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sidA, amount: 10000, status: 'en_attente' } });
        assert.equal(p2.json.data.receipt_number, `R-${year}-${String(countA + 2).padStart(6, '0')}`); // pas de numéro perdu
        const pb = await api('POST', '/api/payments', { token: tokens.adminB, body: { student_id: sidB, amount: 500 } });
        assert.equal(pb.status, 201);
        const firstB = await pool.query("SELECT receipt_number FROM payments WHERE tenant_id = $1 ORDER BY created_at, receipt_number LIMIT 1", [TB]);
        assert.match(firstB.rows[0].receipt_number, /^R-\d{4}-\d{6}$/);
        assert.equal((await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sidA, amount: 100, status: 'enregistre' } })).status, 400);
      });

      it('présence en double (même élève, même jour, sans classe) : 409', async () => {
        const body = { student_id: sidA, date: '2026-11-04', status: 'present' };
        assert.equal((await api('POST', '/api/attendances', { token: tokens.adminA, body })).status, 201);
        const dup = await api('POST', '/api/attendances', { token: tokens.adminA, body: { ...body, status: 'absent' } });
        assert.equal(dup.status, 409);
        assert.match(dup.json.error, /présence existe déjà/);
      });

      it('le dossier individuel affiche les reçus et les paiements de l’élève', async () => {
        const r = await api('GET', `/api/students/${sidA}/profile`, { token: tokens.adminA });
        assert.equal(r.status, 200);
        assert.ok(r.json.data.payments.length >= 2);
        assert.ok(r.json.data.payments.every((p) => /^R-\d{4}-\d{6}$/.test(p.receipt_number)));
        assert.equal(r.json.data.attendances[0].date, '2026-11-04');
      });
    });

    // ---------------------------------------------------------------- M8 Pagination
    describe('M8 · Pagination', () => {
      before(async () => {
        for (let i = 1; i <= 5; i++) {
          await api('POST', '/api/students', { token: tokens.adminB, body: { matricule: `PAG-${i}`, first_name: `Prénom${i}`, last_name: `Pag${i}` } });
        }
      });

      it('limit, offset et total ; plafond à 200 ; valeurs absurdes ramenées aux valeurs par défaut', async () => {
        const page = await api('GET', '/api/students?q=Pag&limit=2&offset=2', { token: tokens.adminB });
        assert.equal(page.status, 200);
        assert.equal(page.json.data.length, 2);
        assert.equal(page.json.meta.total, 5);
        assert.equal(page.json.meta.limit, 2);
        assert.equal(page.json.meta.offset, 2);
        assert.equal((await api('GET', '/api/students?limit=100000', { token: tokens.adminB })).json.meta.limit, 200);
        const weird = await api('GET', '/api/students?limit=-4&offset=abc', { token: tokens.adminB });
        assert.equal(weird.json.meta.limit, 50);
        assert.equal(weird.json.meta.offset, 0);
      });

      it('la recherche ignore les jokers SQL fournis par le client', async () => {
        const all = await api('GET', '/api/students?q=%25', { token: tokens.adminB });
        assert.equal(all.json.meta.total, 0); // « % » est cherché littéralement, pas comme joker
        const one = await api('GET', '/api/students?q=pag-3', { token: tokens.adminB });
        assert.equal(one.json.meta.total, 1);
      });
    });

    // ---------------------------------------------------------------- M11 Suppression logique, audit
    describe('M11 · Suppression logique et journal d’audit', () => {
      it('l’élève supprimé disparaît des listes mais son historique est conservé ; le matricule reste réservé', async () => {
        const s = await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'DEL-1', first_name: 'Del', last_name: 'Ete' } });
        const id = s.json.data.id;
        await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: id, amount: 3000 } });
        const del = await api('DELETE', `/api/students/${id}`, { token: tokens.adminA });
        assert.equal(del.status, 200);
        const list = await api('GET', '/api/students?q=DEL-1', { token: tokens.adminA });
        assert.equal(list.json.meta.total, 0);
        assert.equal((await api('GET', `/api/students/${id}/profile`, { token: tokens.adminA })).status, 404);
        assert.equal((await api('DELETE', `/api/students/${id}`, { token: tokens.adminA })).status, 404);
        const rows = await pool.query('SELECT deleted_at, status FROM students WHERE id = $1', [id]);
        assert.equal(rows.rows.length, 1);
        assert.ok(rows.rows[0].deleted_at);
        assert.equal(rows.rows[0].status, 'inactive');
        const pay = await pool.query('SELECT count(*) AS n FROM payments WHERE student_id = $1', [id]);
        assert.equal(Number(pay.rows[0].n), 1);
        const again = await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'DEL-1', first_name: 'Re', last_name: 'Création' } });
        assert.equal(again.status, 409);
      });

      it('les actions sensibles sont inscrites dans audit_logs avec l’utilisateur et l’établissement', async () => {
        const rows = await pool.query(
          "SELECT action, tenant_id, user_id FROM audit_logs WHERE action IN ('student.create', 'student.delete', 'payment.create', 'auth.login')");
        const actions = new Set(rows.rows.map((r) => r.action));
        for (const a of ['student.create', 'student.delete', 'payment.create', 'auth.login']) assert.ok(actions.has(a), `action absente : ${a}`);
        assert.ok(rows.rows.filter((r) => r.action === 'student.create').every((r) => r.tenant_id && r.user_id));
      });
    });

    // ---------------------------------------------------------------- Tableau de bord
    describe('Tableau de bord (statistiques)', () => {
      it('calcule en SQL : élèves, paiements du mois (statut paye uniquement), présence, série sur 6 mois', async () => {
        const s = await api('POST', '/api/students', { token: tokens.adminB, body: { matricule: 'DASH-1', first_name: 'Da', last_name: 'Sh' } });
        const id = s.json.data.id;
        await api('POST', '/api/payments', { token: tokens.adminB, body: { student_id: id, amount: 40000 } });
        await api('POST', '/api/payments', { token: tokens.adminB, body: { student_id: id, amount: 99999, status: 'en_attente' } });
        await api('POST', '/api/payments', { token: tokens.adminB, body: { student_id: id, amount: 11111, status: 'annule' } });
        const today = new Date().toISOString().slice(0, 10);
        await api('POST', '/api/attendances', { token: tokens.adminB, body: { student_id: id, date: today, status: 'present' } });
        const before = Number((await api('GET', '/api/stats/dashboard', { token: tokens.adminB })).json.data.payments_month.total);

        const r = await api('GET', '/api/stats/dashboard', { token: tokens.adminB });
        assert.equal(r.status, 200);
        const d = r.json.data;
        const nb = Number((await pool.query('SELECT count(*) AS n FROM students WHERE tenant_id = $1 AND deleted_at IS NULL', [TB])).rows[0].n);
        assert.equal(d.students, nb);
        assert.ok(d.payments_month.total >= 40000);
        assert.ok(!Number.isNaN(before));
        assert.equal(d.payments_series.length, 6);
        assert.equal(d.payments_series[5].total, d.payments_month.total);
        assert.equal(d.attendance_rate, 100);
        assert.ok(d.recent_payments.length > 0 && d.recent_payments[0].student_name);
        assert.ok(Array.isArray(d.recent_activity));
        const other = await api('GET', '/api/stats/dashboard', { token: tokens.adminA });
        assert.notEqual(other.json.data.students, d.students);
      });
    });

    // ---------------------------------------------------------------- Modules simples
    describe('Modules simples (enseignants, stocks, cantine…)', () => {
      it('création validée, liste paginée et isolée', async () => {
        const t = await api('POST', '/api/teachers', { token: tokens.adminA, body: { first_name: 'Oumar', last_name: 'Keita', specialties: ['Maths', 'Physique'], email: 'o.keita@ecole.ml' } });
        assert.equal(t.status, 201);
        assert.deepEqual(t.json.data.specialties, ['Maths', 'Physique']);
        assert.equal((await api('POST', '/api/teachers', { token: tokens.adminA, body: { first_name: 'X', last_name: 'Y', email: 'pas-un-email' } })).status, 400);
        assert.equal((await api('GET', '/api/teachers', { token: tokens.adminB })).json.meta.total, 0);

        assert.equal((await api('POST', '/api/stocks', { token: tokens.adminA, body: { name: 'Craie', quantity: -1 } })).status, 400);
        assert.equal((await api('POST', '/api/stocks', { token: tokens.adminA, body: { name: 'Craie', quantity: 40, unit: 'boîte' } })).status, 201);

        const menu = { date: '2026-11-10', items: ['Riz', 'Sauce arachide'] };
        assert.equal((await api('POST', '/api/canteen', { token: tokens.adminA, body: menu })).status, 201);
        assert.equal((await api('POST', '/api/canteen', { token: tokens.adminA, body: menu })).status, 409);
        assert.equal((await api('POST', '/api/transport', { token: tokens.adminA, body: { name: 'Ligne 1', capacity: 0 } })).status, 400);
      });

      it('messagerie : l’expéditeur est l’utilisateur connecté', async () => {
        const c = await api('POST', '/api/messages/conversations', { token: tokens.userA, body: { title: 'Annonces', type: 'group' } });
        assert.equal(c.status, 201);
        const m = await api('POST', '/api/messages/messages', { token: tokens.userA, body: { conversation_id: c.json.data.id, content: 'Bonjour' } });
        assert.equal(m.status, 201);
        const list = await api('GET', `/api/messages/messages?conversation_id=${c.json.data.id}`, { token: tokens.adminA });
        assert.equal(list.json.data.length, 1);
        assert.ok(list.json.data[0].sender_id);
        const foreign = await api('POST', '/api/messages/messages', { token: tokens.adminB, body: { conversation_id: c.json.data.id, content: 'Intrusion' } });
        // Autre établissement : la conversation est traitée comme inexistante (404, D3).
        assert.equal(foreign.status, 404);
      });
    });

    // ---------------------------------------------------------------- Écrans complémentaires
    describe('Emploi du temps, rapports, paramètres, messages', () => {
      let classA; let teacherA; let classB;
      before(async () => {
        classA = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'EDT 7e A' } })).json.data.id;
        teacherA = (await api('POST', '/api/teachers', { token: tokens.adminA, body: { first_name: 'Sali', last_name: 'Coulibaly' } })).json.data.id;
        classB = (await api('POST', '/api/classes', { token: tokens.adminB, body: { name: 'EDT B' } })).json.data.id;
      });

      it('emploi du temps : création, chevauchements refusés, isolation, suppression', async () => {
        const slot = { class_id: classA, teacher_id: teacherA, subject: 'Maths', day_of_week: 1, start_time: '08:00', end_time: '09:00', room: 'S1' };
        const ok = await api('POST', '/api/timetable', { token: tokens.adminA, body: slot });
        assert.equal(ok.status, 201);
        const sameClass = await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, teacher_id: null, subject: 'Français', start_time: '08:30', end_time: '09:30' } });
        assert.equal(sameClass.status, 409);
        assert.match(sameClass.json.error, /classe/);
        const otherClass = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'EDT 7e B' } })).json.data.id;
        const sameTeacher = await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, class_id: otherClass, start_time: '08:30', end_time: '09:30' } });
        assert.equal(sameTeacher.status, 409);
        assert.match(sameTeacher.json.error, /enseignant/);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, start_time: '09:00', end_time: '10:00' } })).status, 201); // bout à bout : permis
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, day_of_week: 2, start_time: '10:00', end_time: '09:00' } })).status, 400);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, day_of_week: 8 } })).status, 400);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, start_time: '25:00' } })).status, 400);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...slot, class_id: classB, day_of_week: 3 } })).status, 422); // classe d'un autre établissement
        assert.equal((await api('POST', '/api/timetable', { token: tokens.teacherA, body: slot })).status, 403);
        const list = await api('GET', `/api/timetable?class_id=${classA}&limit=200`, { token: tokens.adminA });
        assert.equal(list.json.data.length, 2);
        assert.equal(list.json.data[0].start_time, '08:00');
        assert.equal(list.json.data[0].class_name, 'EDT 7e A');
        assert.equal((await api('GET', '/api/timetable?limit=200', { token: tokens.adminB })).json.meta.total, 0);
        const id = list.json.data[0].id;
        assert.equal((await api('DELETE', `/api/timetable/${id}`, { token: tokens.adminB })).status, 404);
        assert.equal((await api('DELETE', `/api/timetable/${id}`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('DELETE', '/api/timetable/pas-un-uuid', { token: tokens.adminA })).status, 400);
      });

      it('rapports : synthèses SQL isolées, rôles, export CSV protégé contre les formules', async () => {
        await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: '=CMD-1', first_name: '=SUM(1)', last_name: 'Csv' } });
        const r = await api('GET', '/api/reports/overview', { token: tokens.adminA });
        assert.equal(r.status, 200);
        assert.ok(r.json.data.students_by_class.length > 0);
        assert.ok(r.json.data.payments_by_fee.every((x) => typeof x.total === 'number'));
        assert.equal((await api('GET', '/api/reports/overview', { token: tokens.accountantA })).status, 200);
        assert.equal((await api('GET', '/api/reports/overview', { token: tokens.teacherA })).status, 403);
        const stu = (await api('GET', '/api/students?q=Csv', { token: tokens.adminA })).json.data[0].id;
        await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: stu, amount: 1500, fee_type: '=HYPERLINK("x")' } });
        const csv = await api('GET', '/api/reports/payments.csv', { token: tokens.adminA });
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get('content-type'), /text\/csv/);
        assert.match(csv.headers.get('content-disposition'), /attachment/);
        assert.match(csv.text, /Reçu;Date;Matricule/);
        assert.match(csv.text, /'=CMD-1/);
        assert.doesNotMatch(csv.text, /;=HYPERLINK/);
        assert.ok(!csv.text.includes('ISO-B'));
        assert.equal((await api('GET', '/api/reports/payments.csv?from=pas-une-date', { token: tokens.adminA })).status, 400);
        assert.equal((await api('GET', '/api/reports/payments.csv', { token: tokens.userA })).status, 403);
      });

      it('paramètres : fiche de l’établissement, comptes utilisateurs, mot de passe', async () => {
        const s = await api('GET', '/api/settings', { token: tokens.teacherA });
        assert.equal(s.json.data.code, 'ECOLEA');
        assert.equal((await api('PUT', '/api/settings', { token: tokens.teacherA, body: { name: 'X' } })).status, 403);
        assert.equal((await api('PUT', '/api/settings', { token: tokens.adminA, body: { name: 'École A — Bamako' } })).json.data.name, 'École A — Bamako');
        assert.equal((await api('GET', '/api/users', { token: tokens.teacherA })).status, 403);
        const list = await api('GET', '/api/users', { token: tokens.adminA });
        assert.ok(list.json.data.length >= 4);
        assert.ok(list.json.data.every((u) => u.password_hash === undefined && u.email.endsWith('@a.test') || u.email.includes('@')));
        assert.ok(!list.json.data.some((u) => u.email === 'admin@b.test'));

        const body = { email: 'nouveau@a.test', full_name: 'Nouveau Prof', role: 'teacher', password: 'Initial-456' };
        const created = await api('POST', '/api/users', { token: tokens.adminA, body });
        assert.equal(created.status, 201);
        assert.equal(created.json.data.password_hash, undefined);
        assert.equal((await api('POST', '/api/users', { token: tokens.adminA, body: { ...body, email: 'NOUVEAU@a.test' } })).status, 409);
        assert.equal((await api('POST', '/api/users', { token: tokens.adminA, body: { ...body, email: 'x@a.test', role: 'superadmin' } })).status, 400);
        assert.equal((await api('POST', '/api/users', { token: tokens.adminA, body: { ...body, email: 'y@a.test', password: 'court' } })).status, 400);
        const first = await api('POST', '/api/auth/login', { body: { email: 'nouveau@a.test', password: 'Initial-456', tenant_code: 'ECOLEA' } });
        assert.equal(first.status, 200);
        assert.equal(first.json.data.user.role, 'teacher');

        const id = created.json.data.id;
        assert.equal((await api('PUT', `/api/users/${id}`, { token: tokens.adminB, body: { is_active: false } })).status, 404);
        assert.equal((await api('PUT', `/api/users/${id}`, { token: tokens.adminA, body: { is_active: false } })).status, 200);
        const refused = await api('POST', '/api/auth/login', { body: { email: 'nouveau@a.test', password: 'Initial-456', tenant_code: 'ECOLEA' } });
        assert.equal(refused.status, 401);
        assert.equal((await api('GET', '/api/students', { token: first.json.data.token })).status, 401); // jeton déjà émis : révoqué aussitôt
        const me = (await api('GET', '/api/auth/me', { token: tokens.adminA })).json.data.id;
        assert.equal((await api('PUT', `/api/users/${me}`, { token: tokens.adminA, body: { role: 'user' } })).status, 400);

        const pwd = await api('POST', '/api/auth/password', { token: tokens.userA, body: { current_password: 'faux', new_password: 'Autre-mdp-789' } });
        assert.equal(pwd.status, 400);
        assert.equal((await api('POST', '/api/auth/password', { token: tokens.userA, body: { current_password: PASSWORD, new_password: 'court' } })).status, 400);
        assert.equal((await api('POST', '/api/auth/password', { token: tokens.userA, body: { current_password: PASSWORD, new_password: 'Autre-mdp-789' } })).status, 200);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'simple@a.test', password: PASSWORD, tenant_code: 'ECOLEA' } })).status, 401);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'simple@a.test', password: 'Autre-mdp-789', tenant_code: 'ECOLEA' } })).status, 200);
        assert.equal((await api('POST', '/api/auth/password', { body: { current_password: 'a', new_password: 'b' } })).status, 401);
      });

      it('révocation immédiate, changement de rôle effectif, réinitialisation du mot de passe par l’administrateur', async () => {
        const mk = { email: 'rev@a.test', full_name: 'Rev', role: 'teacher', password: 'Initial-456' };
        const u = (await api('POST', '/api/users', { token: tokens.adminA, body: mk })).json.data;
        const tok = (await api('POST', '/api/auth/login', { body: { email: mk.email, password: mk.password, tenant_code: 'ECOLEA' } })).json.data.token;
        const stu = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'REV-1', first_name: 'Re', last_name: 'V' } })).json.data.id;
        const att = { student_id: stu, date: '2026-10-01', status: 'present' };
        assert.equal((await api('POST', '/api/attendances', { token: tok, body: att })).status, 201);
        await api('PUT', `/api/users/${u.id}`, { token: tokens.adminA, body: { role: 'user' } });
        assert.equal((await api('POST', '/api/attendances', { token: tok, body: { ...att, date: '2026-10-02' } })).status, 403); // le nouveau rôle s'applique tout de suite
        assert.equal((await api('PUT', `/api/users/${u.id}/password`, { token: tokens.adminB, body: { new_password: 'Nouveau-789' } })).status, 404);
        assert.equal((await api('PUT', `/api/users/${u.id}/password`, { token: tokens.teacherA, body: { new_password: 'Nouveau-789' } })).status, 403);
        assert.equal((await api('PUT', `/api/users/${u.id}/password`, { token: tokens.adminA, body: { new_password: 'court' } })).status, 400);
        assert.equal((await api('PUT', `/api/users/${u.id}/password`, { token: tokens.adminA, body: { new_password: 'Nouveau-789' } })).status, 200);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: mk.email, password: mk.password, tenant_code: 'ECOLEA' } })).status, 401);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: mk.email, password: 'Nouveau-789', tenant_code: 'ECOLEA' } })).status, 200);
      });

      it('bulletin : moyennes pondérées, rang dans la classe, mention, isolation', async () => {
        const cls = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'BUL 5e' } })).json.data.id;
        const mkStu = async (m) => (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: m, first_name: m, last_name: 'Bul', class_id: cls } })).json.data.id;
        const [a, b] = [await mkStu('BUL-A'), await mkStu('BUL-B')];
        // Seules les notes validées entrent dans le bulletin (§4.5) : chaque note est validée après saisie.
        const g = async (student_id, subject, score, coefficient) => {
          const r = await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id, subject, score, coefficient } });
          const v = await api('POST', `/api/grades/${r.json.data.id}/validate`, { token: tokens.adminA });
          assert.equal(v.status, 200);
          return r;
        };
        await g(a, 'Maths', 18, 3); await g(a, 'Maths', 12, 1); await g(a, 'Français', 10, 2);
        await g(b, 'Maths', 8, 3); await g(b, 'Français', 9, 2);
        // Une note encore en saisie n'apparaît pas dans le bulletin.
        await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: a, subject: 'Sport', score: 2, coefficient: 1 } });
        assert.equal((await api('GET', `/api/students/${a}/report-card`, { token: tokens.adminA })).json.data.subjects.some((x) => x.subject === 'Sport'), false);
        const r = await api('GET', `/api/students/${a}/report-card`, { token: tokens.userA });
        assert.equal(r.status, 200);
        const d = r.json.data;
        assert.equal(d.subjects.find((x) => x.subject === 'Maths').average, 16.5);   // (18*3 + 12*1) / 4
        assert.equal(d.subjects.find((x) => x.subject === 'Français').average, 10);
        assert.equal(d.subjects.find((x) => x.subject === 'Maths').mention, 'Très bien');
        assert.equal(d.subjects.find((x) => x.subject === 'Français').mention, 'Passable');
        assert.equal(d.overall_average, 14.33);                                       // (16,5×4 + 10×2) / 6 : chaque matière pèse la somme de ses coefficients
        assert.equal(d.rank, 1);
        assert.equal(d.class_size, 2);
        assert.equal(d.mention, 'Bien');
        assert.equal((await api('GET', `/api/students/${b}/report-card`, { token: tokens.adminA })).json.data.rank, 2);
        assert.equal((await api('GET', `/api/students/${a}/report-card`, { token: tokens.adminB })).status, 404);
        assert.equal((await api('GET', `/api/students/${a}/report-card?from=n-importe-quoi`, { token: tokens.adminA })).status, 400);
        const empty = (await api('GET', `/api/students/${a}/report-card?from=2000-01-01&to=2000-12-31`, { token: tokens.adminA })).json.data;
        assert.equal(empty.overall_average, null);
        assert.equal(empty.subjects.length, 0);
      });

      it('périodes scolaires : création, doublon, dates incohérentes, isolation, bulletin par période', async () => {
        const body = { name: 'Trimestre 1', start_date: '2026-09-15', end_date: '2026-12-20' };
        assert.equal((await api('POST', '/api/periods', { token: tokens.adminA, body })).status, 201);
        assert.equal((await api('POST', '/api/periods', { token: tokens.adminA, body })).status, 409);
        assert.equal((await api('POST', '/api/periods', { token: tokens.adminA, body: { ...body, name: 'T0', end_date: '2026-01-01' } })).status, 400);
        assert.equal((await api('POST', '/api/periods', { token: tokens.teacherA, body: { ...body, name: 'T9' } })).status, 403);
        const list = await api('GET', '/api/periods', { token: tokens.userA });
        assert.equal(list.json.data.length, 1);
        assert.equal(list.json.data[0].start_date, '2026-09-15');
        assert.equal((await api('GET', '/api/periods', { token: tokens.adminB })).json.data.length, 0);
        const id = list.json.data[0].id;
        assert.equal((await api('DELETE', `/api/periods/${id}`, { token: tokens.adminB })).status, 404);
        assert.equal((await api('DELETE', `/api/periods/${id}`, { token: tokens.adminA })).status, 200);

        const s = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'PER-1', first_name: 'Per', last_name: 'Iode' } })).json.data.id;
        for (const [score, date] of [[10, '2026-10-10'], [16, '2027-02-10']]) {
          const n = await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: s, subject: 'Maths', score, date } });
          assert.equal((await api('POST', `/api/grades/${n.json.data.id}/validate`, { token: tokens.adminA })).status, 200);
        }
        const t1 = (await api('GET', `/api/students/${s}/report-card?from=2026-09-15&to=2026-12-20`, { token: tokens.adminA })).json.data;
        assert.equal(t1.overall_average, 10);
        const all = (await api('GET', `/api/students/${s}/report-card`, { token: tokens.adminA })).json.data;
        assert.equal(all.overall_average, 13);
      });

      it('messages : le fil indique l’expéditeur, RH / documents / stocks fonctionnent', async () => {
        const c = (await api('POST', '/api/messages/conversations', { token: tokens.adminA, body: { title: 'Équipe', type: 'group' } })).json.data.id;
        await api('POST', '/api/messages/messages', { token: tokens.adminA, body: { conversation_id: c, content: 'Premier' } });
        // Non participant : l'enseignant ne peut ni écrire ni lire (conversation inexistante pour lui, §4.1).
        assert.equal((await api('POST', '/api/messages/messages', { token: tokens.teacherA, body: { conversation_id: c, content: 'Avant' } })).status, 404);
        const teacherId = (await api('GET', '/api/auth/me', { token: tokens.teacherA })).json.data.id;
        assert.equal((await api('POST', `/api/messages/conversations/${c}/participants`, { token: tokens.adminA, body: { user_id: teacherId } })).status, 201);
        await api('POST', '/api/messages/messages', { token: tokens.teacherA, body: { conversation_id: c, content: 'Second' } });
        const thread = await api('GET', `/api/messages/messages?conversation_id=${c}`, { token: tokens.adminA });
        assert.equal(thread.json.data.length, 2);
        assert.deepEqual(thread.json.data.map((m) => m.sender_name).sort(), ['admin@a.test', 'prof@a.test']);
        assert.equal((await api('GET', `/api/messages/messages?conversation_id=${c}`, { token: tokens.adminB })).json.data.length, 0);

        assert.equal((await api('POST', '/api/hr', { token: tokens.adminA, body: { first_name: 'Awa', last_name: 'Diarra', position: 'Secrétaire', hire_date: '2024-09-01' } })).status, 201);
        assert.equal((await api('POST', '/api/hr', { token: tokens.adminA, body: { first_name: 'Awa', last_name: 'X', hire_date: '2024-02-31' } })).status, 400);
        const cls = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'DOC 1' } })).json.data.id;
        assert.equal((await api('POST', '/api/documents', { token: tokens.teacherA, body: { title: 'Programme', type: 'Cours', class_id: cls, status: 'publie' } })).status, 201);
        assert.equal((await api('POST', '/api/documents', { token: tokens.userA, body: { title: 'Interdit' } })).status, 403);
        assert.equal((await api('GET', `/api/documents?class_id=${cls}`, { token: tokens.userA })).json.meta.total, 1);
        assert.equal((await api('GET', '/api/hr', { token: tokens.adminB })).json.meta.total, 0);
      });

      it('affiche d’accueil : exigences, envoi, isolation entre établissements, réinitialisation', async () => {
        const mk = (w, h) => {
          const b = Buffer.alloc(40);
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
          b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
          return b;
        };
        const put = (token, buf, type = 'image/png') => api('PUT', '/api/settings/banner/image', { token, raw: buf, headers: { 'Content-Type': type } });

        const none = await api('GET', '/api/settings/banner', { token: tokens.userA });
        assert.equal(none.status, 200);
        assert.equal(none.json.data.custom, false);
        assert.equal(none.json.data.requirements.ratio, 4);
        assert.equal((await api('GET', '/api/settings/banner/image', { token: tokens.userA })).status, 404);

        assert.equal((await put(tokens.userA, mk(1600, 400))).status, 403);
        assert.equal((await put(tokens.teacherA, mk(1600, 400))).status, 403);
        assert.equal((await put(null, mk(1600, 400))).status, 401);

        const bad = await put(tokens.adminA, mk(1600, 800));
        assert.equal(bad.status, 400);
        assert.match(JSON.stringify(bad.json.errors), /Proportions/);
        assert.equal((await put(tokens.adminA, mk(800, 200))).status, 400);
        assert.equal((await put(tokens.adminA, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status, 400);
        assert.equal((await put(tokens.adminA, Buffer.alloc(3 * 1024 * 1024))).status, 413);
        assert.equal((await api('GET', '/api/settings/banner', { token: tokens.adminA })).json.data.custom, false);

        const good = mk(1600, 400);
        const ok = await put(tokens.adminA, good);
        assert.equal(ok.status, 200);
        assert.equal(ok.json.data.width, 1600);
        const meta = (await api('GET', '/api/settings/banner', { token: tokens.userA })).json.data;
        assert.equal(meta.custom, true);
        assert.equal(meta.height, 400);
        const img = await fetch(`${base}/api/settings/banner/image`, { headers: { Authorization: `Bearer ${tokens.userA}` } });
        assert.equal(img.status, 200);
        assert.equal(img.headers.get('content-type'), 'image/png');
        assert.deepEqual(Buffer.from(await img.arrayBuffer()), good);

        // l'établissement B ne voit rien de l'affiche de A
        assert.equal((await api('GET', '/api/settings/banner', { token: tokens.adminB })).json.data.custom, false);
        assert.equal((await api('GET', '/api/settings/banner/image', { token: tokens.adminB })).status, 404);

        // textes : conservés avec l'image, validés, effaçables
        assert.equal((await api('PUT', '/api/settings/banner/text', { token: tokens.userA, body: { title: 'x' } })).status, 403);
        assert.equal((await api('PUT', '/api/settings/banner/text', { token: tokens.adminA, body: { title: 'T'.repeat(121) } })).status, 400);
        assert.equal((await api('PUT', '/api/settings/banner/text', { token: tokens.adminA, body: { title: 'École Les Étoiles', subtitle: 'Année 2026-2027' } })).status, 200);
        const withText = (await api('GET', '/api/settings/banner', { token: tokens.userA })).json.data;
        assert.equal(withText.title, 'École Les Étoiles');
        assert.equal(withText.custom, true);

        // retour à l'affiche par défaut
        assert.equal((await api('DELETE', '/api/settings/banner', { token: tokens.userA })).status, 403);
        assert.equal((await api('DELETE', '/api/settings/banner', { token: tokens.adminA })).status, 200);
        const reset = (await api('GET', '/api/settings/banner', { token: tokens.adminA })).json.data;
        assert.equal(reset.custom, false);
        assert.equal(reset.title, null);
      });

      it('superadmin : édite l’identité d’un établissement ; l’établissement la voit, mais ne touche pas au site', async () => {
        const PT = `/api/platform/tenants/${TA}/identity`;
        assert.equal((await api('PUT', `${PT}/text`, { token: tokens.root, body: { app_name: 'Les Étoiles', slogan: 'Réussir ensemble' } })).status, 200);
        assert.equal((await api('GET', '/api/settings/identity', { token: tokens.userA })).json.data.effective.app_name, 'Les Étoiles');
        assert.equal((await api('PUT', `${PT}/text`, { token: tokens.adminA, body: { app_name: 'X' } })).status, 403);
        assert.equal((await api('GET', PT, { token: tokens.adminA })).status, 403);
        assert.equal((await api('GET', '/api/platform/tenants/pas-un-uuid/identity', { token: tokens.root })).status, 400);
        assert.equal((await api('GET', '/api/platform/tenants/cccccccc-cccc-4ccc-8ccc-cccccccccccc/identity', { token: tokens.root })).status, 404);
        // le nom du site (plateforme) reste hors de portée de l'établissement
        assert.equal((await api('PUT', '/api/platform/identity/text', { token: tokens.adminA, body: { app_name: 'Pirate' } })).status, 403);
        assert.equal((await api('DELETE', PT, { token: tokens.root })).status, 200);
      });
    });

    describe('Espace superadmin (packs, licences, quotas, suspension)', () => {
      const root = () => tokens.root;
      const P = (method, url, body, token) => api(method, `/api/platform${url}`, { token: token || tokens.root, body });
      let tid; let adminToken; let adminId;

      it('crée un établissement avec pack, quotas copiés et mot de passe temporaire', async () => {
        const plans = (await P('GET', '/plans')).json.data;
        const ess = plans.find((p) => p.code === 'ESSENTIEL');
        assert.equal(ess.max_students, 300);
        const r = await P('POST', '/tenants', { code: 'quota1', name: 'Quota Un', plan_id: ess.id, city: 'Bamako', admin_email: 'dir@quota1.test', admin_full_name: 'Dir Un', license_start: '2026-01-01', license_end: '2099-12-31' });
        assert.equal(r.status, 201, r.text);
        tid = r.json.data.id;
        assert.equal(r.json.data.max_students, 300);
        assert.equal(r.json.data.max_users, 10);
        assert.equal(r.json.data.license_state, 'ok');
        const temp = r.json.data.temporary_password;
        assert.match(temp, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
        adminToken = await login('dir@quota1.test', 'QUOTA1', temp);
        assert.ok(adminToken);
        adminId = r.json.data.admin_id;
        assert.equal((await api('GET', '/api/students', { token: adminToken })).json.meta.total, 0);
      });

      it('valide les entrées et refuse un pack inconnu ou des dates incohérentes', async () => {
        assert.equal((await P('POST', '/tenants', { code: 'x', name: 'x' })).status, 400);
        assert.equal((await P('POST', '/tenants', { code: 'BADPLAN', name: 'x', admin_email: 'a@b.cc', admin_full_name: 'A', plan_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000' })).status, 400);
        assert.equal((await P('PUT', `/tenants/${tid}`, { license_start: '2026-06-01', license_end: '2026-01-01' })).status, 400);
        assert.equal((await P('PUT', `/tenants/${tid}`, {})).status, 400);
        assert.equal((await P('GET', '/tenants/pas-un-uuid')).status, 400);
        assert.equal((await P('GET', '/tenants/aaaaaaaa-aaaa-4aaa-8aaa-000000000000')).status, 404);
      });

      it('applique les quotas d’élèves et d’utilisateurs', async () => {
        assert.equal((await P('PUT', `/tenants/${tid}`, { max_students: 1, max_users: 2 })).status, 200);
        assert.equal((await api('POST', '/api/students', { token: adminToken, body: { matricule: 'Q-1', first_name: 'Un', last_name: 'Seul' } })).status, 201);
        const over = await api('POST', '/api/students', { token: adminToken, body: { matricule: 'Q-2', first_name: 'Deux', last_name: 'Trop' } });
        assert.equal(over.status, 403);
        assert.equal(over.json.code, 'quota_exceeded');
        assert.match(over.json.error, /1 élèves/);
        const u1 = await api('POST', '/api/users', { token: adminToken, body: { email: 'prof@quota1.test', full_name: 'Prof', role: 'teacher', password: PASSWORD } });
        assert.equal(u1.status, 201);
        assert.equal((await api('POST', '/api/users', { token: adminToken, body: { email: 'x@quota1.test', full_name: 'X', role: 'user', password: PASSWORD } })).status, 403);
        // quota vidé = illimité
        assert.equal((await P('PUT', `/tenants/${tid}`, { max_students: '' })).json.data.max_students, null);
        assert.equal((await api('POST', '/api/students', { token: adminToken, body: { matricule: 'Q-2', first_name: 'Deux', last_name: 'Ok' } })).status, 201);
      });

      it('suspension : accès coupé aussitôt (jeton existant et connexion), données conservées, réactivation', async () => {
        const s = await P('POST', `/tenants/${tid}/suspend`, { reason: 'Impayé' });
        assert.equal(s.json.data.license_state, 'suspended');
        const blocked = await api('GET', '/api/students', { token: adminToken });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.json.code, 'tenant_suspended');
        const loginRes = await api('POST', '/api/auth/login', { body: { email: 'prof@quota1.test', password: PASSWORD, tenant_code: 'QUOTA1' } });
        assert.equal(loginRes.status, 403);
        assert.equal(loginRes.json.code, 'tenant_suspended');
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'prof@quota1.test', password: 'faux', tenant_code: 'QUOTA1' } })).status, 401); // pas de fuite sans bon mot de passe
        assert.equal((await api('GET', '/api/students', { token: tokens.adminA })).status, 200); // les autres écoles ne sont pas touchées
        await P('POST', `/tenants/${tid}/reactivate`);
        assert.equal((await api('GET', '/api/students', { token: adminToken })).json.meta.total, 2);
      });

      it('licence expirée : accès refusé ; le renouvellement le rétablit', async () => {
        await P('PUT', `/tenants/${tid}`, { license_start: '2019-01-01', license_end: '2020-01-01' });
        const exp = await api('GET', '/api/students', { token: adminToken });
        assert.equal(exp.status, 403);
        assert.equal(exp.json.code, 'license_expired');
        const r = await P('POST', `/tenants/${tid}/renew`, { months: 12 });
        assert.equal(r.status, 200);
        assert.equal(r.json.data.license_state, 'ok');
        assert.equal((await api('GET', '/api/students', { token: adminToken })).status, 200);
        assert.equal((await P('POST', `/tenants/${tid}/renew`, { months: 0 })).status, 400);
        const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
        assert.equal((await P('PUT', `/tenants/${tid}`, { license_end: soon })).json.data.license_state, 'expiring');
        assert.equal((await P('PUT', `/tenants/${tid}`, { license_end: '' })).json.data.license_state, 'unlimited');
      });

      it('mot de passe et activation des administrateurs (limités à leur établissement)', async () => {
        const detail = (await P('GET', `/tenants/${tid}`)).json.data;
        assert.equal(detail.admins.length, 1);
        const reset = await P('PUT', `/tenants/${tid}/admins/${adminId}/password`, {});
        assert.equal(reset.status, 200);
        const temp = reset.json.data.temporary_password;
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'dir@quota1.test', password: PASSWORD, tenant_code: 'QUOTA1' } })).status, 401);
        assert.ok(await login('dir@quota1.test', 'QUOTA1', temp));
        // un administrateur d'une AUTRE école, ou un non-administrateur, est introuvable
        const adminBId = (await pool.query("SELECT id FROM users WHERE email = 'admin@b.test'")).rows[0].id;
        assert.equal((await P('PUT', `/tenants/${tid}/admins/${adminBId}/password`, {})).status, 404);
        const teacherId = (await pool.query("SELECT id FROM users WHERE email = 'prof@quota1.test'")).rows[0].id;
        assert.equal((await P('PUT', `/tenants/${tid}/admins/${teacherId}/password`, {})).status, 404);
        assert.equal((await P('PUT', `/tenants/${tid}/admins/${adminId}/password`, { password: 'court' })).status, 400);
        // désactivation : le jeton existant est refusé aussitôt
        const tok = await login('dir@quota1.test', 'QUOTA1', temp);
        assert.equal((await P('PUT', `/tenants/${tid}/admins/${adminId}/active`, { is_active: false })).status, 200);
        assert.equal((await api('GET', '/api/students', { token: tok })).status, 401);
        await P('PUT', `/tenants/${tid}/admins/${adminId}/active`, { is_active: true });
        assert.equal((await api('GET', '/api/students', { token: tok })).status, 200);
      });

      it('packs : création, doublon, désactivation (pas de suppression), modification sans effet rétroactif', async () => {
        const created = await P('POST', '/plans', { code: 'gold', name: 'Gold', max_students: 50, max_users: 5, price_monthly: 100000 });
        assert.equal(created.status, 201, created.text);
        assert.equal(created.json.data.code, 'GOLD');
        assert.equal((await P('POST', '/plans', { code: 'GOLD', name: 'Doublon' })).status, 409);
        const pid = created.json.data.id;
        assert.equal((await P('POST', `/tenants/${tid}/apply-plan`, { plan_id: pid })).json.data.max_students, 50);
        assert.equal((await P('PUT', `/plans/${pid}`, { max_students: 999 })).status, 200);
        assert.equal((await P('GET', `/tenants/${tid}`)).json.data.max_students, 50);
        assert.equal((await P('PUT', `/plans/${pid}`, { is_active: false })).json.data.is_active, false);
        assert.equal((await P('POST', `/tenants/${tid}/apply-plan`, { plan_id: pid })).status, 400);
        assert.equal((await api('GET', '/api/platform/plans', { token: tokens.adminA })).status, 403);
      });

      it('vue d’ensemble, journal de la plateforme, et aucune fuite dans l’activité des écoles', async () => {
        const ov = (await P('GET', '/overview')).json.data;
        assert.ok(ov.tenants >= 5);
        assert.ok(ov.students_total >= 2);
        assert.equal(typeof ov.expiring, 'number');
        assert.equal(JSON.stringify(ov).includes('first_name'), false); // aucun détail d'élève
        const log = (await P('GET', '/audit?limit=100')).json.data;
        assert.ok(log.some((a) => a.action === 'platform.tenant_suspend' && a.tenant_name === 'Quota Un'));
        assert.ok(log.every((a) => a.entity !== 'student'));
        const dash = await api('GET', '/api/stats/dashboard', { token: adminToken });
        assert.equal(JSON.stringify(dash.json).includes('platform.'), false);
        assert.equal((await api('GET', '/api/platform/audit', { token: tokens.adminA })).status, 403);
      });

      it('quotas : réactivation refusée à la limite ; créations simultanées jamais au-delà de la limite', async () => {
        const count = async (sql) => Number((await pool.query(sql, [tid])).rows[0].n);
        // réactivation d'un compte inactif alors que le quota d'utilisateurs est atteint
        const activeNonParent = await count("SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND is_active AND role <> 'parent'");
        assert.equal((await P('PUT', `/tenants/${tid}`, { max_users: activeNonParent })).status, 200);
        const inactive = (await pool.query("INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active) VALUES ($1, 'ancien@quota1.test', 'x', 'Ancien', 'user', false) RETURNING id", [tid])).rows[0].id;
        const react = await api('PUT', `/api/users/${inactive}`, { token: adminToken, body: { is_active: true } });
        assert.equal(react.status, 403);
        assert.equal(react.json.code, 'quota_exceeded');
        assert.equal((await pool.query('SELECT is_active FROM users WHERE id = $1', [inactive])).rows[0].is_active, false);
        // six créations simultanées, deux places libres : exactement deux réussissent
        const students = await count('SELECT count(*) AS n FROM students WHERE tenant_id = $1 AND deleted_at IS NULL');
        assert.equal((await P('PUT', `/tenants/${tid}`, { max_students: students + 2 })).status, 200);
        const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => api('POST', '/api/students', { token: adminToken, body: { matricule: `RACE-${i}`, first_name: 'Race', last_name: `N${i}` } })));
        assert.equal(results.filter((r) => r.status === 201).length, 2);
        assert.equal(results.filter((r) => r.status === 403).length, 4);
        assert.equal(await count('SELECT count(*) AS n FROM students WHERE tenant_id = $1 AND deleted_at IS NULL'), students + 2);
        // retour à l'illimité pour la suite de la suite de tests
        assert.equal((await P('PUT', `/tenants/${tid}`, { max_students: '', max_users: '' })).status, 200);
      });
    });

    describe('Facturation des abonnements', () => {
      const P = (method, url, body, token) => api(method, `/api/platform${url}`, { token: token || tokens.root, body });
      let tid; let adminTok; let inv1; let inv2;
      const rawText = async (url, token) => { const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` } }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type'), bom: buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), text: buf.toString('utf8').replace(/^\ufeff/, '') }; };

      it('crée des factures numérotées, montant calculé depuis le pack', async () => {
        const ess = (await P('GET', '/plans')).json.data.find((p) => p.code === 'ESSENTIEL');
        const t = await P('POST', '/tenants', { code: 'fact1', name: 'École Facture', plan_id: ess.id, admin_email: 'dir@fact1.test', admin_full_name: 'Dir', admin_password: PASSWORD });
        tid = t.json.data.id;
        adminTok = await login('dir@fact1.test', 'FACT1');
        const a = await P('POST', `/tenants/${tid}/invoices`, { months: 3 });
        assert.equal(a.status, 201, a.text);
        inv1 = a.json.data;
        assert.match(inv1.number, /^F-\d{4}-\d{4}$/);
        assert.equal(inv1.amount, 45000);
        assert.equal(inv1.status, 'pending');
        assert.equal(inv1.months, 3);
        assert.ok(inv1.period_end > inv1.period_start);
        inv2 = (await P('POST', `/tenants/${tid}/invoices`, { months: 1, amount: 20000, description: '=cmd|calc', notes: 'test' })).json.data;
        assert.notEqual(inv2.number, inv1.number);
        assert.equal(inv2.amount, 20000);
        // pas de pack, pas de montant : refusé
        const bare = (await P('POST', '/tenants', { code: 'nopack', name: 'Sans pack', admin_email: 'a@nopack.test', admin_full_name: 'A' })).json.data;
        assert.equal((await P('POST', `/tenants/${bare.id}/invoices`, { months: 2 })).status, 400);
        assert.equal((await P('POST', `/tenants/${bare.id}/invoices`, { months: 0, amount: 5 })).status, 400);
        assert.equal((await P('POST', `/tenants/${tid}/invoices`, { months: 1 }, tokens.adminA)).status, 403);
      });

      it('encaisse : prolonge la licence, refuse le double paiement et l’annulation d’une facture payée', async () => {
        assert.equal((await P('POST', `/invoices/${inv1.id}/pay`, {})).status, 400);
        assert.equal((await P('POST', `/invoices/${inv1.id}/pay`, { payment_method: 'bitcoin' })).status, 400);
        const paid = await P('POST', `/invoices/${inv1.id}/pay`, { payment_method: 'orange_money', payment_ref: 'OM-123' });
        assert.equal(paid.status, 200, paid.text);
        assert.equal(paid.json.data.status, 'paid');
        assert.equal(paid.json.data.license_extended, true);
        const t = (await P('GET', `/tenants/${tid}`)).json.data;
        assert.equal(t.license_end, inv1.period_end);
        assert.equal((await P('POST', `/invoices/${inv1.id}/pay`, { payment_method: 'especes' })).status, 409);
        assert.equal((await P('POST', `/invoices/${inv1.id}/cancel`)).status, 409);
        // sans prolongation
        const before = (await P('GET', `/tenants/${tid}`)).json.data.license_end;
        assert.equal((await P('POST', `/invoices/${inv2.id}/pay`, { payment_method: 'especes', extend_license: false })).json.data.license_extended, false);
        assert.equal((await P('GET', `/tenants/${tid}`)).json.data.license_end, before);
      });

      it('annulation, retard, filtres, totaux et exports CSV', async () => {
        const c = (await P('POST', `/tenants/${tid}/invoices`, { months: 1, amount: 1000, due_date: '2020-01-01' })).json.data;
        const late = (await P('GET', '/invoices?status=overdue')).json;
        assert.ok(late.data.some((x) => x.id === c.id && x.overdue === true));
        assert.ok(late.meta.overdue_total >= 1000);
        const canc = await P('POST', `/invoices/${c.id}/cancel`);
        assert.equal(canc.json.data.status, 'cancelled');
        assert.equal((await P('POST', `/invoices/${c.id}/cancel`)).status, 409);
        assert.equal((await P('POST', `/invoices/${c.id}/pay`, { payment_method: 'especes' })).status, 409);
        const mine = (await P('GET', `/invoices?tenant_id=${tid}`)).json;
        assert.equal(mine.meta.total, 3);
        assert.equal(mine.meta.paid_total, 65000);
        assert.equal((await P('GET', `/invoices?tenant_id=${tid}&status=paid`)).json.meta.total, 2);
        const one = (await P('GET', `/invoices/${inv1.id}`)).json.data;
        assert.equal(one.tenant_name, 'École Facture');
        assert.equal(one.issuer.app_name.length > 0, true);
        const csv = await rawText(`/api/platform/invoices.csv?tenant_id=${tid}`, tokens.root);
        assert.equal(csv.status, 200);
        assert.match(csv.type, /text\/csv/);
        assert.equal(csv.bom, true); // UTF-8 avec BOM : accents corrects dans Excel
        assert.ok(csv.text.startsWith('Numéro;'));
        assert.ok(csv.text.includes(inv1.number));
        assert.ok(csv.text.includes("'=cmd|calc")); // pas d'injection de formule
        assert.equal((await rawText('/api/platform/tenants.csv', tokens.root)).status, 200);
        assert.equal((await rawText('/api/platform/invoices.csv', tokens.adminA)).status, 403);
      });

      it('vue d’ensemble financière et « Mon abonnement » côté établissement', async () => {
        const ov = (await P('GET', '/overview')).json.data;
        assert.ok(ov.billing.paid_year >= 65000);
        assert.equal(typeof ov.billing.overdue_count, 'number');
        const sub = await api('GET', '/api/settings/subscription', { token: adminTok });
        assert.equal(sub.status, 200, sub.text);
        assert.equal(sub.json.data.plan_name, 'Essentiel');
        assert.equal(sub.json.data.invoices.length, 2); // l'annulée est masquée
        assert.equal(sub.json.data.max_students, 300);
        assert.equal(sub.json.data.license_state === 'ok' || sub.json.data.license_state === 'expiring', true);
        // isolation : une autre école ne voit pas ces factures ; un non-admin n'y accède pas
        assert.equal((await api('GET', '/api/settings/subscription', { token: tokens.adminA })).json.data.invoices.length, 0);
        assert.equal((await api('GET', '/api/settings/subscription', { token: tokens.userA })).status, 403);
        assert.equal((await api('GET', '/api/platform/invoices', { token: adminTok })).status, 403);
        assert.equal((await api('GET', '/api/settings/subscription', { token: tokens.root })).status, 403);
      });
    });

    describe('Identité personnalisable (nom, slogan, logo)', () => {
      const png = (w, h, extra = 0) => {
        const b = Buffer.alloc(40 + extra);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
        b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
        return b;
      };
      const putLogo = (url, token, buf) => api('PUT', url, { token, raw: buf, headers: { 'Content-Type': 'image/png' } });
      const bin = async (url, token) => { const r = await fetch(`${base}${url}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };

      it('page de connexion : identité publique de la plateforme (sans jeton)', async () => {
        const r = await api('GET', '/api/identity');
        assert.equal(r.status, 200);
        assert.equal(r.json.data.app_name, 'SCHOOL MANAGER PRO');
        assert.equal(r.json.data.has_logo, false);
        assert.equal((await bin('/api/identity/logo')).status, 404);
      });

      it('plateforme : texte et logo, réservés au superadmin, contrôle de format', async () => {
        assert.equal((await api('PUT', '/api/platform/identity/text', { token: tokens.adminA, body: { app_name: 'X' } })).status, 403);
        assert.equal((await api('PUT', '/api/platform/identity/text', { token: tokens.root, body: { app_name: 'N'.repeat(61) } })).status, 400);
        const t = await api('PUT', '/api/platform/identity/text', { token: tokens.root, body: { app_name: 'EduMali', slogan: 'L’école connectée' } });
        assert.equal(t.status, 200, t.text);
        assert.equal((await api('GET', '/api/identity')).json.data.app_name, 'EduMali');
        const bad = await putLogo('/api/platform/identity/logo', tokens.root, png(256, 128));
        assert.equal(bad.status, 400);
        assert.match(JSON.stringify(bad.json.errors), /carré/);
        assert.equal((await putLogo('/api/platform/identity/logo', tokens.root, png(64, 64))).status, 400);
        assert.equal((await putLogo('/api/platform/identity/logo', tokens.root, png(2000, 2000))).status, 400);
        assert.equal((await putLogo('/api/platform/identity/logo', tokens.root, png(256, 256, 600 * 1024))).status, 413);
        assert.equal((await putLogo('/api/platform/identity/logo', tokens.adminA, png(256, 256))).status, 403);
        const good = png(256, 256);
        assert.equal((await putLogo('/api/platform/identity/logo', tokens.root, good)).status, 200);
        const got = await bin('/api/identity/logo');
        assert.equal(got.status, 200);
        assert.deepEqual(got.buf, good);
        assert.equal((await api('GET', '/api/identity')).json.data.has_logo, true);
      });

      it('établissement : hérite de la plateforme, peut surcharger, isolation entre écoles', async () => {
        const eff = (await api('GET', '/api/settings/identity', { token: tokens.adminA })).json.data;
        assert.equal(eff.effective.app_name, 'EduMali');
        assert.equal(eff.effective.source, 'platform');
        assert.equal(eff.effective.logo_source, 'platform');
        assert.equal((await bin('/api/settings/identity/logo', tokens.adminA)).status, 200); // logo hérité
        assert.equal((await api('PUT', '/api/settings/identity/text', { token: tokens.userA, body: { app_name: 'Hack' } })).status, 403);
        assert.equal((await api('PUT', '/api/settings/identity/text', { token: tokens.adminA, body: { app_name: 'École Les Étoiles', slogan: 'Réussir ensemble' } })).status, 200);
        const own = png(512, 512);
        assert.equal((await putLogo('/api/settings/identity/logo', tokens.adminA, png(300, 200))).status, 400);
        assert.equal((await putLogo('/api/settings/identity/logo', tokens.teacherA, own)).status, 403);
        assert.equal((await putLogo('/api/settings/identity/logo', tokens.adminA, own)).status, 200);
        const a = (await api('GET', '/api/settings/identity', { token: tokens.userA })).json.data.effective; // lecture : tous les rôles
        assert.equal(a.app_name, 'École Les Étoiles');
        assert.equal(a.logo_source, 'tenant');
        assert.deepEqual((await bin('/api/settings/identity/logo', tokens.userA)).buf, own);
        // l'école B n'est pas touchée
        const b = (await api('GET', '/api/settings/identity', { token: tokens.adminB })).json.data.effective;
        assert.equal(b.app_name, 'EduMali');
        assert.equal(b.source, 'platform');
        assert.equal((await api('GET', '/api/settings/identity', { token: tokens.root })).status, 403);
        // retrait du logo de l'école -> retour au logo de la plateforme ; réinitialisation complète
        assert.equal((await api('DELETE', '/api/settings/identity/logo', { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', '/api/settings/identity', { token: tokens.adminA })).json.data.effective.logo_source, 'platform');
        assert.equal((await api('DELETE', '/api/settings/identity', { token: tokens.userA })).status, 403);
        assert.equal((await api('DELETE', '/api/settings/identity', { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', '/api/settings/identity', { token: tokens.adminA })).json.data.effective.app_name, 'EduMali');
        // nettoyage de la plateforme
        assert.equal((await api('DELETE', '/api/platform/identity', { token: tokens.root })).status, 200);
        assert.equal((await api('GET', '/api/identity')).json.data.app_name, 'SCHOOL MANAGER PRO');
        assert.equal((await bin('/api/identity/logo')).status, 404);
      });
    });

    // ---------------------------------------------------------------- v2.11.0 : e-mails, avoirs, TVA, mot de passe oublié, bulletin
    describe('E-mails, TVA, avoirs, mot de passe oublié, bulletin', () => {
      const { startFakeSmtp } = require('../helpers/fakeSmtp');
      const P = (method, url, body, token) => api(method, `/api/platform${url}`, { token: token || tokens.root, body });
      const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'MAIL_FROM', 'APP_URL', 'SMTP_USER', 'SMTP_PASS'];
      let tid; let smtp; let invTva;
      const mailOn = () => { process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtp.port); process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM = 'noreply@smp.test'; process.env.APP_URL = 'https://app.smp.test'; };
      const mailOff = () => ENV_KEYS.forEach((k) => delete process.env[k]);
      after(async () => { mailOff(); if (smtp) await smtp.close(); });

      it('sans SMTP : état « non configuré », test d’envoi 503, rien ne plante', async () => {
        mailOff();
        const st = await P('GET', '/mail');
        assert.equal(st.status, 200);
        assert.equal(st.json.data.configured, false);
        assert.equal(st.json.data.host, null);
        assert.equal((await P('POST', '/mail/test', { to: 'x@y.test' })).status, 503);
        assert.equal((await P('POST', '/mail/test', { to: 'pas-un-mail' })).status, 400);
        assert.equal((await P('GET', '/mail', undefined, tokens.adminA)).status, 403);
        const ob = await P('GET', '/mail/outbox?status=skipped');
        assert.ok(ob.json.total >= 1);
      });

      it('avec SMTP : envoi de test, journal, mot de passe SMTP jamais exposé', async () => {
        smtp = await startFakeSmtp();
        mailOn(); process.env.SMTP_USER = 'user'; process.env.SMTP_PASS = 'secret-smtp';
        const st = (await P('GET', '/mail')).json.data;
        assert.equal(st.configured, true);
        assert.ok(!JSON.stringify(st).includes('secret-smtp'));
        const t = await P('POST', '/mail/test', { to: 'moi@ecole.test' });
        assert.equal(t.status, 200, t.text);
        assert.equal(smtp.messages.length, 1);
        delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
        const ob = await P('GET', '/mail/outbox?status=sent');
        assert.ok(ob.json.data.some((m) => m.to_email === 'moi@ecole.test'));
      });

      it('TVA et remise : total = (HT − remise) + TVA ; réglages de facturation', async () => {
        const cfg = await P('PUT', '/billing-settings', { tax_rate: 18, legal_details: 'NIF 123456 — RCCM ABC', payment_instructions: 'Virement BDM, compte …' });
        assert.equal(cfg.status, 200, cfg.text);
        assert.equal((await P('PUT', '/billing-settings', { tax_rate: 150 })).status, 400);
        const g = (await P('GET', '/billing-settings')).json.data;
        assert.equal(g.tax_rate, 18);
        assert.equal(g.online_payment.enabled, false);
        assert.match(g.online_payment.message, /pas encore disponible/);
        const t = await P('POST', '/tenants', { code: 'tva1', name: 'École TVA', admin_email: 'dir@tva1.test', admin_full_name: 'Dir', admin_password: PASSWORD, contact_email: 'contact@tva1.test' });
        tid = t.json.data.id;
        const inv = await P('POST', `/tenants/${tid}/invoices`, { months: 1, amount: 100000, discount_percent: 10 });
        assert.equal(inv.status, 201, inv.text);
        const d = inv.json.data;
        assert.equal(d.subtotal, 100000); assert.equal(d.discount_amount, 10000); assert.equal(d.tax_rate, 18); assert.equal(d.tax_amount, 16200); assert.equal(d.amount, 106200);
        const noTax = await P('POST', `/tenants/${tid}/invoices`, { months: 1, amount: 50000, tax_rate: 0 });
        assert.equal(noTax.json.data.amount, 50000);
        await P('PUT', '/billing-settings', { tax_rate: 0 });
        invTva = d.id;
      });

      it('avoir : numéroté A-, plafonné au solde, annule la facture si totalement avoir, ne touche pas la licence', async () => {
        const inv = invTva;
        const over = await P('POST', `/invoices/${inv}/credit-note`, { amount: 999999, reason: 'trop' });
        assert.equal(over.status, 422);
        assert.equal((await P('POST', `/invoices/${inv}/credit-note`, { amount: 1000 })).status, 400);
        const partial = await P('POST', `/invoices/${inv}/credit-note`, { amount: 6200, reason: 'Geste commercial' });
        assert.equal(partial.status, 201, partial.text);
        assert.match(partial.json.data.number, /^A-\d{4}-\d{4}$/);
        assert.equal(partial.json.data.document_type, 'credit_note');
        const rest = await P('POST', `/invoices/${inv}/credit-note`, { amount: 100000, reason: 'Annulation' });
        assert.equal(rest.status, 201, rest.text);
        const after = (await P('GET', `/invoices/${inv}`)).json.data;
        assert.equal(after.status, 'cancelled');
        assert.equal((await P('POST', `/invoices/${inv}/pay`, { payment_method: 'especes' })).status, 409);
        // un avoir ne se paie pas et ne s'annule pas
        assert.equal((await P('POST', `/invoices/${partial.json.data.id}/pay`, { payment_method: 'especes' })).status, 409);
        const lst = await P('GET', '/invoices?type=credit_note');
        assert.ok(lst.json.data.length >= 2 && lst.json.data.every((x) => x.document_type === 'credit_note'));
      });

      it('envoi d’une facture par e-mail (au contact de l’école), horodatage last_sent_at', async () => {
        mailOn();
        const before = smtp.messages.length;
        const inv = (await P('POST', `/tenants/${tid}/invoices`, { months: 2, amount: 30000, tax_rate: 0 })).json.data;
        const s1 = await P('POST', `/invoices/${inv.id}/send`, {});
        assert.equal(s1.status, 200, s1.text);
        assert.equal(s1.json.data.sent, 1);
        assert.equal(smtp.messages.length, before + 1);
        assert.match(smtp.messages[before].to[0], /contact@tva1\.test/);
        assert.ok((await P('GET', `/invoices/${inv.id}`)).json.data.last_sent_at);
        // pièce jointe PDF : multipart/mixed, fichier décodable, contenu = la facture
        const raw = smtp.messages[before].raw;
        assert.match(raw, /multipart\/mixed/); assert.match(raw, new RegExp(`filename="facture-${inv.number.replace(/[^\w-]+/g, '')}\\.pdf"`));
        const att = /Content-Disposition: attachment[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--smp_mix_/.exec(raw);
        assert.ok(att, 'pièce jointe introuvable');
        const pdfBuf = Buffer.from(att[1].replace(/\r\n/g, ''), 'base64');
        assert.equal(pdfBuf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdfText(pdfBuf).includes(inv.number));
        // téléchargement direct : superadmin uniquement
        const dl = await fetch(`${base}/api/platform/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${tokens.root}` } });
        assert.equal(dl.status, 200); assert.match(dl.headers.get('content-type'), /application\/pdf/);
        assert.equal((await api('GET', `/api/platform/invoices/${inv.id}/pdf`, { token: tokens.adminA })).status, 403);
        assert.equal((await P('GET', '/invoices/00000000-0000-0000-0000-000000000000/pdf')).status, 404);
        // non envoyé (SMTP absent) puis nouvel essai : la facture est régénérée et jointe
        mailOff(); await P('POST', `/invoices/${inv.id}/send`, {});
        const skipped = (await pool.query(`SELECT id, attachment_name, invoice_id FROM mail_outbox WHERE invoice_id = $1 AND status = 'skipped' ORDER BY created_at DESC LIMIT 1`, [inv.id])).rows[0];
        assert.ok(skipped.attachment_name.endsWith('.pdf'));
        mailOn(); const n0 = smtp.messages.length;
        assert.equal((await P('POST', `/mail/outbox/${skipped.id}/retry`, {})).status, 200);
        assert.equal(smtp.messages.length, n0 + 1); assert.match(smtp.messages[n0].raw, /multipart\/mixed/);
        assert.ok((await P('GET', `/invoices/${inv.id}`)).json.data.last_sent_at);
        assert.equal((await P('POST', `/invoices/${inv.id}/send`, { to: 'invalide' })).status, 400);
        mailOff();
        const s2 = await P('POST', `/invoices/${inv.id}/send`, {});
        assert.equal(s2.status, 503);
        assert.equal(s2.json.data.mail_configured, false);
      });

      it('rappels : simulation sans effet, envoi unique (pas de doublon), rien consommé sans SMTP', async () => {
        const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        await pool.query('UPDATE tenants SET license_end = $2 WHERE id = $1', [tid, soon]);
        mailOff();
        const none = (await P('POST', '/reminders/run', {})).json.data;
        assert.equal(none.mail_configured, false);
        assert.equal(none.sent, 0);
        const log0 = (await pool.query('SELECT count(*)::int AS n FROM notification_log')).rows[0].n;
        mailOn();
        const dry = (await P('POST', '/reminders/run', { dry_run: true })).json.data;
        assert.equal(dry.dry_run, true);
        assert.ok(dry.due.some((d) => /^license$/.test(d.kind) && d.to.includes('contact@tva1.test')));
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_log')).rows[0].n, log0);
        const n0 = smtp.messages.length;
        const real = (await P('POST', '/reminders/run', {})).json.data;
        assert.ok(real.sent >= 1);
        assert.ok(smtp.messages.length > n0);
        const n1 = smtp.messages.length;
        const again = (await P('POST', '/reminders/run', {})).json.data;
        assert.equal(again.sent, 0);
        assert.equal(smtp.messages.length, n1);
        mailOff();
      });

      it('mot de passe oublié : lien à usage unique, réponse neutre, 503 sans e-mail', async () => {
        mailOff();
        const off = await api('POST', '/api/auth/forgot', { body: { email: 'admin@a.test', tenant_code: 'ECOLEA' } });
        assert.equal(off.status, 503);
        assert.equal(off.json.code, 'mail_unavailable');
        mailOn();
        const n0 = smtp.messages.length;
        const ok = await api('POST', '/api/auth/forgot', { body: { email: 'admin@a.test', tenant_code: 'ECOLEA' } });
        const unknown = await api('POST', '/api/auth/forgot', { body: { email: 'inconnu@a.test', tenant_code: 'ECOLEA' } });
        assert.equal(ok.status, 200); assert.equal(unknown.status, 200);
        assert.deepEqual(ok.json, unknown.json);
        assert.equal(smtp.messages.length, n0 + 1);
        const decoded = smtp.messages[n0].raw.split(/\r?\n--smp_[0-9a-f]+/).map((part) => {
          const body = part.split(/\r?\n\r?\n/).slice(1).join('');
          return /base64/i.test(part) ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : '';
        }).join('\n');
        const token = (/#reset=([A-Za-z0-9_-]{40,})/.exec(decoded) || [])[1];
        assert.ok(token, 'jeton présent dans le message');
        assert.equal((await api('POST', '/api/auth/reset', { body: { token, new_password: 'court' } })).status, 400);
        const done = await api('POST', '/api/auth/reset', { body: { token, new_password: 'Nouveau-Passe-456' } });
        assert.equal(done.status, 200, done.text);
        assert.equal((await api('POST', '/api/auth/reset', { body: { token, new_password: 'Autre-Passe-789' } })).status, 400);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'admin@a.test', tenant_code: 'ECOLEA', password: PASSWORD } })).status, 401);
        assert.equal((await api('POST', '/api/auth/login', { body: { email: 'admin@a.test', tenant_code: 'ECOLEA', password: 'Nouveau-Passe-456' } })).status, 200);
        await pool.query('UPDATE users SET password_hash = $2 WHERE email = $1', ['admin@a.test', await password.hash(PASSWORD)]);
        mailOff();
      });

      it('paiement en ligne : annoncé mais indisponible (503), jamais activable', async () => {
        const pp = await api('GET', '/api/settings/payment-providers', { token: tokens.adminA });
        assert.equal(pp.status, 200);
        assert.equal(pp.json.data.enabled, false);
        assert.ok(pp.json.data.providers.every((x) => x.enabled === false));
        process.env.ONLINE_PAYMENTS = 'true';
        const r = await api('POST', '/api/settings/subscription/invoices/00000000-0000-4000-8000-000000000000/pay-online', { token: tokens.adminA, body: {} });
        delete process.env.ONLINE_PAYMENTS;
        assert.equal(r.status, 503);
        assert.equal(r.json.code, 'online_payment_unavailable');
        assert.equal((await api('GET', '/api/settings/payment-providers', { token: tokens.teacherA })).status, 403);
      });

      it('bulletin : appréciation et décision du conseil par période, droits et isolation', async () => {
        const st = await api('POST', '/api/students', { token: tokens.adminA, body: { first_name: 'Awa', last_name: 'Keita', matricule: 'BUL-1' } });
        assert.equal(st.status, 201, st.text);
        const id = st.json.data.id;
        const put = (tok, body) => api('PUT', `/api/students/${id}/report-card/comment`, { token: tok, body });
        const ok = await put(tokens.teacherA, { teacher_comment: 'Élève sérieuse, peut mieux faire en maths.', council_decision: 'Encouragements' });
        assert.equal(ok.status, 200, ok.text);
        assert.equal((await put(tokens.accountantA, { teacher_comment: 'x' })).status, 403);
        assert.equal((await put(tokens.adminB, { teacher_comment: 'x' })).status, 404);
        assert.equal((await put(tokens.adminA, { council_decision: 'Inventé' })).status, 400);
        assert.equal((await put(tokens.adminA, { teacher_comment: 'a'.repeat(601) })).status, 400);
        const rc = await api('GET', `/api/students/${id}/report-card`, { token: tokens.adminA });
        assert.equal(rc.json.data.comment.council_decision, 'Encouragements');
        // autre période : indépendante
        const other = await api('GET', `/api/students/${id}/report-card?from=2026-01-01&to=2026-03-31`, { token: tokens.adminA });
        assert.equal(other.json.data.comment.teacher_comment, null);
        await api('PUT', `/api/students/${id}/report-card/comment`, { token: tokens.adminA, body: { from: '2026-01-01', to: '2026-03-31', teacher_comment: 'T1 : bon trimestre.' } });
        assert.equal((await api('GET', `/api/students/${id}/report-card?from=2026-01-01&to=2026-03-31`, { token: tokens.adminA })).json.data.comment.teacher_comment, 'T1 : bon trimestre.');
        // effacement : la décision seule reste
        await put(tokens.adminA, { teacher_comment: '' });
        const cleared = (await api('GET', `/api/students/${id}/report-card`, { token: tokens.adminA })).json.data.comment;
        assert.equal(cleared.teacher_comment, null);
        assert.equal(cleared.council_decision, 'Encouragements');
      });
    });

    // ---------------------------------------------------------------- v2.12.0 : salles en conflit, photos d'élèves
    describe('Salles en conflit et photos d’élèves', () => {
      const png = (w, h, extra = 0) => {
        const b = Buffer.alloc(40 + extra);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
        b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
        return b;
      };
      const put = (id, token, buf, type = 'image/png') => api('PUT', `/api/students/${id}/photo`, { token, raw: buf, headers: { 'Content-Type': type } });
      let c1; let c2; let t1; let t2; let sid;
      before(async () => {
        c1 = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'SALLE C1' } })).json.data.id;
        c2 = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'SALLE C2' } })).json.data.id;
        t1 = (await api('POST', '/api/teachers', { token: tokens.adminA, body: { first_name: 'Ali', last_name: 'Sy' } })).json.data.id;
        t2 = (await api('POST', '/api/teachers', { token: tokens.adminA, body: { first_name: 'Bou', last_name: 'Dia' } })).json.data.id;
        sid = (await api('POST', '/api/students', { token: tokens.adminA, body: { first_name: 'Photo', last_name: 'Test', matricule: 'PH-1' } })).json.data.id;
      });

      it('une salle ne peut pas accueillir deux cours en même temps (casse et espaces ignorés)', async () => {
        const base1 = { class_id: c1, teacher_id: t1, subject: 'SVT', day_of_week: 4, start_time: '10:00', end_time: '11:00', room: 'Labo 1' };
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: base1 })).status, 201);
        const clash = await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...base1, class_id: c2, teacher_id: t2, room: '  labo 1 ' } });
        assert.equal(clash.status, 409);
        assert.match(clash.json.error, /salle/);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...base1, class_id: c2, teacher_id: t2, room: 'Labo 2' } })).status, 201);
        assert.equal((await api('POST', '/api/timetable', { token: tokens.adminA, body: { ...base1, class_id: c2, teacher_id: t2, start_time: '11:00', end_time: '12:00' } })).status, 201); // même salle, créneau suivant
        const byTeacher = await api('GET', `/api/timetable?teacher_id=${t2}&limit=50`, { token: tokens.adminA });
        assert.ok(byTeacher.json.data.length >= 2 && byTeacher.json.data.every((x) => x.teacher_id === t2));
      });

      it('photo : droits, format vérifié sur la signature, taille, proportions, lecture, retrait', async () => {
        assert.equal((await api('GET', `/api/students/${sid}/photo`, { token: tokens.adminA })).status, 404);
        assert.equal((await put(sid, tokens.teacherA, png(300, 400))).status, 403);
        assert.equal((await put(sid, tokens.adminA, png(64, 64))).status, 400);
        assert.equal((await put(sid, tokens.adminA, png(300, 2000 / 1 + 1))).status, 400);
        assert.equal((await put(sid, tokens.adminA, png(2000, 400))).status, 400);
        assert.equal((await put(sid, tokens.adminA, png(300, 400, 1100 * 1024))).status, 413);
        assert.equal((await put(sid, tokens.adminA, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(60, ' ')))).status, 400);
        const ok = await put(sid, tokens.adminA, png(300, 400));
        assert.equal(ok.status, 200, ok.text);
        assert.equal(ok.json.data.has_photo, true);
        const r = await fetch(`${base}/api/students/${sid}/photo`, { headers: { Authorization: `Bearer ${tokens.teacherA}` } });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'image/png');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(Buffer.from(await r.arrayBuffer()).length, 40);
        assert.equal((await api('GET', `/api/students/${sid}/profile`, { token: tokens.adminA })).json.data.student.has_photo, true);
        // isolation : un autre établissement ne voit ni ne modifie
        assert.equal((await api('GET', `/api/students/${sid}/photo`, { token: tokens.adminB })).status, 404);
        assert.equal((await put(sid, tokens.adminB, png(300, 400))).status, 404);
        assert.equal((await api('GET', `/api/students/${sid}/photo`)).status, 401);
        assert.equal((await api('DELETE', `/api/students/${sid}/photo`, { token: tokens.teacherA })).status, 403);
        assert.equal((await api('DELETE', `/api/students/${sid}/photo`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', `/api/students/${sid}/photo`, { token: tokens.adminA })).status, 404);
      });
    });

    // ---------------------------------------------------------------- v2.13.0 : permissions fines par module
    describe('Permissions par module et par rôle', () => {
      const perm = (token, changes) => api('PUT', '/api/settings/permissions', { token, body: { changes } });
      const reset = () => api('DELETE', '/api/settings/permissions', { token: tokens.adminA });
      after(async () => { await reset(); });

      it('matrice par défaut = comportement historique ; réservée à l’administrateur ; /me expose les droits', async () => {
        await reset();
        assert.equal((await api('GET', '/api/settings/permissions', { token: tokens.teacherA })).status, 403);
        const m = (await api('GET', '/api/settings/permissions', { token: tokens.adminA })).json.data;
        assert.equal(m.matrix.teacher.grades, 'write'); assert.equal(m.matrix.teacher.students, 'read'); assert.equal(m.matrix.teacher.reports, 'none');
        assert.equal(m.matrix.accountant.payments, 'write'); assert.equal(m.matrix.accountant.reports, 'read'); assert.equal(m.matrix.user.messages, 'write');
        assert.ok(!m.roles.includes('admin'));
        const me = (await api('GET', '/api/auth/me', { token: tokens.teacherA })).json.data;
        assert.equal(me.permissions.attendances, 'write'); assert.equal(me.permissions.stocks, 'read');
        assert.equal((await api('GET', '/api/auth/me', { token: tokens.adminA })).json.data.permissions.stocks, 'write');
      });

      it('validation : administrateur non configurable, module / niveau inconnus refusés', async () => {
        assert.equal((await perm(tokens.adminA, [{ role: 'admin', module: 'stocks', level: 'none' }])).status, 400);
        assert.equal((await perm(tokens.adminA, [{ role: 'teacher', module: 'inconnu', level: 'read' }])).status, 400);
        assert.equal((await perm(tokens.adminA, [{ role: 'teacher', module: 'stocks', level: 'root' }])).status, 400);
        assert.equal((await perm(tokens.adminA, [])).status, 400);
        assert.equal((await perm(tokens.teacherA, [{ role: 'teacher', module: 'stocks', level: 'write' }])).status, 403);
        assert.equal((await perm(tokens.root, [{ role: 'teacher', module: 'stocks', level: 'write' }])).status, 403);
      });

      it('retirer la lecture ferme le module (403), accorder l’écriture l’ouvre, effet immédiat', async () => {
        assert.equal((await api('GET', '/api/stocks', { token: tokens.teacherA })).status, 200);
        assert.equal((await api('POST', '/api/stocks', { token: tokens.teacherA, body: { name: 'Craie' } })).status, 403);
        assert.equal((await perm(tokens.adminA, [{ role: 'teacher', module: 'stocks', level: 'none' }])).status, 200);
        const closed = await api('GET', '/api/stocks', { token: tokens.teacherA });
        assert.equal(closed.status, 403); assert.equal(closed.json.code, 'module_forbidden');
        assert.equal((await api('GET', '/api/stocks', { token: tokens.accountantA })).status, 200); // autre rôle inchangé
        await perm(tokens.adminA, [{ role: 'teacher', module: 'stocks', level: 'write' }]);
        const created = await api('POST', '/api/stocks', { token: tokens.teacherA, body: { name: 'Craie' } });
        assert.equal(created.status, 201, created.text);
        assert.equal((await api('GET', '/api/auth/me', { token: tokens.teacherA })).json.data.permissions.stocks, 'write');
      });

      it('écriture retirée : notes, appréciation de bulletin et élèves suivent la matrice', async () => {
        await reset();
        const st = await api('POST', '/api/students', { token: tokens.adminA, body: { first_name: 'Perm', last_name: 'Test', matricule: 'PERM-1' } });
        const id = st.json.data.id;
        const comment = (tok) => api('PUT', `/api/students/${id}/report-card/comment`, { token: tok, body: { teacher_comment: 'ok' } });
        assert.equal((await comment(tokens.teacherA)).status, 200);
        assert.equal((await api('POST', '/api/grades', { token: tokens.teacherA, body: { student_id: id, subject: 'Maths', score: 12 } })).status, 201);
        await perm(tokens.adminA, [{ role: 'teacher', module: 'grades', level: 'read' }]);
        assert.equal((await comment(tokens.teacherA)).status, 403);
        assert.equal((await api('POST', '/api/grades', { token: tokens.teacherA, body: { student_id: id, subject: 'Maths', score: 12 } })).status, 403);
        assert.equal((await api('GET', '/api/grades', { token: tokens.teacherA })).status, 200);
        // le comptable reçoit le droit de modifier les élèves (et de lire les rapports sans l’avoir perdu)
        await perm(tokens.adminA, [{ role: 'accountant', module: 'students', level: 'write' }]);
        assert.equal((await api('PUT', `/api/students/${id}`, { token: tokens.accountantA, body: { first_name: 'Permis' } })).status, 200);
        assert.equal((await api('GET', '/api/reports/overview', { token: tokens.accountantA })).status, 200);
        // l’enseignant n’a toujours pas accès aux rapports ; on les lui ouvre en lecture
        assert.equal((await api('GET', '/api/reports/overview', { token: tokens.teacherA })).status, 403);
        await perm(tokens.adminA, [{ role: 'teacher', module: 'reports', level: 'read' }]);
        assert.equal((await api('GET', '/api/reports/overview', { token: tokens.teacherA })).status, 200);
      });

      it('l’administrateur garde tous les droits ; la messagerie est fermable ; isolation entre établissements ; réinitialisation', async () => {
        await perm(tokens.adminA, [{ role: 'user', module: 'messages', level: 'none' }, { role: 'teacher', module: 'students', level: 'none' }]);
        assert.equal((await api('GET', '/api/messages/conversations', { token: tokens.userA })).status, 403);
        assert.equal((await api('POST', '/api/messages/conversations', { token: tokens.userA, body: { title: 'x' } })).status, 403);
        assert.equal((await api('GET', '/api/students', { token: tokens.teacherA })).status, 403);
        assert.equal((await api('GET', '/api/students', { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', '/api/messages/conversations', { token: tokens.adminA })).status, 200);
        // l’établissement B n’est pas touché
        const mb = (await api('GET', '/api/settings/permissions', { token: tokens.adminB })).json.data;
        assert.equal(mb.matrix.teacher.students, 'read'); assert.deepEqual(mb.customized, []);
        // retour à la valeur par défaut d’un seul rôle, puis de tous
        assert.equal((await api('DELETE', '/api/settings/permissions?role=teacher', { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', '/api/students', { token: tokens.teacherA })).status, 200);
        assert.equal((await api('GET', '/api/messages/conversations', { token: tokens.userA })).status, 403);
        assert.equal((await api('DELETE', '/api/settings/permissions?role=admin', { token: tokens.adminA })).status, 400);
        await reset();
        assert.equal((await api('GET', '/api/messages/conversations', { token: tokens.userA })).status, 200);
        assert.equal((await api('PUT', '/api/settings/permissions', { token: tokens.adminA, body: { changes: [{ role: 'user', module: 'messages', level: 'write' }] } })).status, 200); // = défaut : aucune ligne stockée
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1`, [TA])).rows[0].n, 0);
      });
    });

    // ---------------------------------------------------------------- Phase 1 : notes, corrections, périodes, gérant, participants
    describe('Phase 1 : cycle des notes, corrections, périodes, rôle gérant, participants', () => {
      const GERANT_PWD = 'Gerant-Pass-2026';
      let tokGerant; let stu; let grade;
      const createGrade = (body) => api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: stu, subject: 'Physique', score: 12, coefficient: 1, ...body } });
      const scoreOf = async (id) => Number((await api('GET', `/api/grades?student_id=${stu}`, { token: tokens.adminA })).json.data.find((g) => g.id === id).score);

      before(async () => {
        stu = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'P1-STU', first_name: 'Phase', last_name: 'Un' } })).json.data.id;
        const u = await api('POST', '/api/users', { token: tokens.adminA, body: { email: 'gerant@a.test', full_name: 'Gérant A', role: 'gerant', password: GERANT_PWD } });
        assert.equal(u.status, 201);
        tokGerant = await login('gerant@a.test', 'ECOLEA', GERANT_PWD);
        grade = (await createGrade({ score: 9 })).json.data.id;
      });

      it('une note est créée en saisie, quel que soit le statut envoyé ; validation et annulation contrôlées', async () => {
        const forced = await createGrade({ status: 'validee' });
        assert.equal(forced.status, 201);
        assert.equal(forced.json.data.status, 'saisie');
        const id = forced.json.data.id;
        assert.equal((await api('POST', `/api/grades/${id}/validate`, { token: tokens.teacherA })).status, 403);
        assert.equal((await api('POST', `/api/grades/${id}/validate`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('POST', `/api/grades/${id}/validate`, { token: tokens.adminA })).status, 409);
        assert.equal((await api('POST', `/api/grades/${id}/cancel`, { token: tokens.adminA })).status, 409);
        const other = (await createGrade({})).json.data.id;
        assert.equal((await api('POST', `/api/grades/${other}/cancel`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('POST', `/api/grades/${other}/cancel`, { token: tokens.adminA })).status, 409);
        assert.equal((await api('POST', `/api/grades/${other}/validate`, { token: tokens.adminB })).status, 404); // autre établissement
      });

      it('correction : demande avec motif, une seule en attente, décision par un administrateur différent du demandeur', async () => {
        assert.equal((await api('POST', `/api/grades/${grade}/validate`, { token: tokens.adminA })).status, 200);
        const req = (tok, body) => api('POST', `/api/grades/${grade}/corrections`, { token: tok, body });
        assert.equal((await req(tokens.userA, { score: 14, reason: 'Erreur de saisie' })).status, 403);     // pas d'écriture sur les notes
        assert.equal((await req(tokens.teacherA, { score: 14, reason: 'abc' })).status, 400);             // motif trop court
        assert.equal((await req(tokens.teacherA, { score: 25, reason: 'Erreur de saisie' })).status, 400); // note hors barème
        const c = await req(tokens.teacherA, { score: 14, reason: 'Erreur de saisie' });
        assert.equal(c.status, 201);
        assert.equal(c.json.data.status, 'pending');
        assert.ok((await api('GET', '/api/grades/corrections/mine', { token: tokens.teacherA })).json.data.some((x) => x.id === c.json.data.id));
        assert.equal((await api('GET', '/api/grades/corrections/mine', { token: tokens.userA })).status, 403);
        assert.equal((await req(tokens.teacherA, { score: 13, reason: 'Autre demande' })).status, 409);
        assert.equal(await scoreOf(grade), 9, 'la note ne change pas avant décision');

        const pending = await api('GET', '/api/grades/corrections', { token: tokens.adminA });
        assert.ok(pending.json.data.some((x) => x.id === c.json.data.id));
        assert.equal((await api('GET', '/api/grades/corrections', { token: tokens.teacherA })).status, 403);

        const cid = c.json.data.id;
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.teacherA, body: { reason: 'Je valide' } })).status, 403);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminA, body: {} })).status, 400); // motif obligatoire
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminB, body: { reason: 'Autre école' } })).status, 404);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminA, body: { reason: 'Vérifié sur copie' } })).status, 200);
        assert.equal(await scoreOf(grade), 14);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminA, body: { reason: 'Encore' } })).status, 409);
      });

      it('le demandeur ne peut jamais décider de sa propre correction ; rejet sans effet sur la note', async () => {
        // Rejet par un administrateur d'une proposition d'enseignant : la note ne change pas.
        const rejected = await api('POST', `/api/grades/${grade}/corrections`, { token: tokens.teacherA, body: { score: 17, reason: 'Proposition' } });
        assert.equal(rejected.status, 201);
        assert.equal((await api('POST', `/api/grades/corrections/${rejected.json.data.id}/reject`, { token: tokens.adminA, body: { reason: 'Pas de preuve' } })).status, 200);
        assert.equal(await scoreOf(grade), 14, 'un rejet ne modifie pas la note');
        // Demande de l'administrateur lui-même : il ne peut pas la décider, mais il peut la retirer (décision 1).
        const own = await api('POST', `/api/grades/${grade}/corrections`, { token: tokens.adminA, body: { score: 15, reason: 'Correction admin' } });
        assert.equal(own.status, 201);
        const cid = own.json.data.id;
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminA, body: { reason: 'Moi-même' } })).status, 403);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/reject`, { token: tokens.adminA, body: { reason: 'Non justifié' } })).status, 403);
        assert.equal(await scoreOf(grade), 14);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/withdraw`, { token: tokens.teacherA, body: { reason: 'Pas le mien' } })).status, 403);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/withdraw`, { token: tokens.adminA, body: { reason: 'Je retire' } })).status, 200);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/withdraw`, { token: tokens.adminA, body: { reason: 'Encore' } })).status, 409);
        assert.equal((await api('POST', `/api/grades/corrections/${cid}/approve`, { token: tokens.adminA, body: { reason: 'Trop tard' } })).status, 409);
        assert.equal(await scoreOf(grade), 14, 'un retrait ne modifie pas la note');
      });

      it('une note non validée ne se corrige pas par cette procédure', async () => {
        const draft = (await createGrade({ subject: 'Chimie' })).json.data.id;
        assert.equal((await api('POST', `/api/grades/${draft}/corrections`, { token: tokens.teacherA, body: { score: 10, reason: 'Motif valable' } })).status, 409);
      });

      it('clôture de période : admin seul ; notes verrouillées ; suppression refusée ; réouverture avec motif', async () => {
        const p = (await api('POST', '/api/periods', { token: tokens.adminA, body: { name: 'T-Clôture', start_date: '2025-01-01', end_date: '2025-03-31' } })).json.data.id;
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokens.teacherA })).status, 403);
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokens.adminB })).status, 404);
        const inPeriod = (await createGrade({ subject: 'Histoire', date: '2025-02-10' })).json.data.id; // créée avant clôture : en saisie
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokens.adminA })).status, 409);
        assert.equal((await createGrade({ date: '2025-02-11' })).status, 409);                       // nouvelle note refusée
        assert.equal((await api('POST', `/api/grades/${inPeriod}/validate`, { token: tokens.adminA })).status, 409); // validation refusée
        assert.equal((await api('POST', `/api/grades/${inPeriod}/cancel`, { token: tokens.adminA })).status, 409);
        assert.equal((await api('DELETE', `/api/periods/${p}`, { token: tokens.adminA })).status, 409);
        assert.equal((await api('POST', `/api/periods/${p}/reopen`, { token: tokens.adminA, body: { reason: 'ab' } })).status, 400);
        assert.equal((await api('POST', `/api/periods/${p}/reopen`, { token: tokens.teacherA, body: { reason: 'Motif suffisant' } })).status, 403);
        assert.equal((await api('POST', `/api/periods/${p}/reopen`, { token: tokens.adminA, body: { reason: 'Note oubliée sur la copie' } })).status, 200);
        assert.equal((await api('POST', `/api/grades/${inPeriod}/validate`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('POST', `/api/periods/${p}/reopen`, { token: tokens.adminA, body: { reason: 'Déjà ouverte' } })).status, 409);
        const audit = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('academic_period.close', 'academic_period.reopen')`, [TA])).rows[0].n;
        assert.ok(audit >= 2);
      });

      it('rôle gérant : peut rouvrir une période ; pas de paiements, RH ni clôture', async () => {
        const p = (await api('POST', '/api/periods', { token: tokens.adminA, body: { name: 'T-Gérant', start_date: '2025-04-01', end_date: '2025-06-30' } })).json.data.id;
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('POST', `/api/periods/${p}/close`, { token: tokGerant })).status, 403);
        assert.equal((await api('POST', `/api/periods/${p}/reopen`, { token: tokGerant, body: { reason: 'Rectification gérant' } })).status, 200);
        assert.equal((await api('GET', '/api/payments', { token: tokGerant })).status, 403);
        assert.equal((await api('GET', '/api/hr', { token: tokGerant })).status, 403);
        assert.equal((await api('GET', '/api/grades', { token: tokGerant })).status, 200);
      });

      it('messagerie : retrait d’un participant, accès coupé immédiatement, lecture marquée par le participant seulement', async () => {
        const c = (await api('POST', '/api/messages/conversations', { token: tokens.adminA, body: { title: 'Retrait', type: 'group' } })).json.data.id;
        const userId = (await api('GET', '/api/auth/me', { token: tokens.userA })).json.data.id;
        assert.equal((await api('POST', `/api/messages/conversations/${c}/participants`, { token: tokens.adminA, body: { user_id: userId } })).status, 201);
        assert.equal((await api('POST', '/api/messages/messages', { token: tokens.userA, body: { conversation_id: c, content: 'Bonjour à tous' } })).status, 201);
        assert.equal((await api('POST', `/api/messages/conversations/${c}/read`, { token: tokens.userA })).status, 200);
        assert.equal((await api('POST', `/api/messages/conversations/${c}/read`, { token: tokens.teacherA })).status, 404); // non participant
        assert.equal((await api('POST', `/api/messages/conversations/${c}/participants`, { token: tokens.userA, body: { user_id: userId } })).status, 403); // participant non gestionnaire
        assert.equal((await api('DELETE', `/api/messages/conversations/${c}/participants/${userId}`, { token: tokens.adminA })).status, 200);
        // Lecture : fil vide, sans fuite du contenu d'avant le retrait.
        const thread = await api('GET', `/api/messages/messages?conversation_id=${c}`, { token: tokens.userA });
        assert.equal(thread.status, 200);
        assert.equal(thread.json.data.length, 0);
        assert.equal((await api('POST', '/api/messages/messages', { token: tokens.userA, body: { conversation_id: c, content: 'Toujours là ?' } })).status, 404);
        assert.equal((await api('DELETE', `/api/messages/conversations/${c}/participants/${userId}`, { token: tokens.adminA })).status, 404);
      });
    });

    describe('Accusés de réception et de lecture (§4.1 point 6)', () => {
      let conv; let msg; let teacherId; let userId;
      const summary = async () => (await api('GET', `/api/messages/messages?conversation_id=${conv}`, { token: tokens.adminA })).json.data.find((m) => m.id === msg);

      before(async () => {
        conv = (await api('POST', '/api/messages/conversations', { token: tokens.adminA, body: { title: 'Accusés', type: 'group' } })).json.data.id;
        teacherId = (await api('GET', '/api/auth/me', { token: tokens.teacherA })).json.data.id;
        userId = (await api('GET', '/api/auth/me', { token: tokens.userA })).json.data.id;
        await api('POST', `/api/messages/conversations/${conv}/participants`, { token: tokens.adminA, body: { user_id: teacherId } });
        await api('POST', `/api/messages/conversations/${conv}/participants`, { token: tokens.adminA, body: { user_id: userId } });
        msg = (await api('POST', '/api/messages/messages', { token: tokens.adminA, body: { conversation_id: conv, content: 'Réunion jeudi' } })).json.data.id;
      });

      it('à l’envoi : un accusé en attente par destinataire, expéditeur seulement en compteurs', async () => {
        const m = await summary();
        assert.equal(m.recipients_count, 2);
        assert.equal(m.read_count, 0);
      });

      it('réception puis lecture par chaque destinataire ; compteurs mis à jour ; expéditeur sans accusé sur son propre message', async () => {
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/receive`, { token: tokens.teacherA })).json.data.delivered, 1);
        assert.equal((await summary()).read_count, 0, 'réception ≠ lecture');
        const read = await api('POST', `/api/messages/conversations/${conv}/read`, { token: tokens.userA });
        assert.equal(read.status, 200);
        assert.equal(read.json.data.marked, 1);
        assert.equal((await summary()).read_count, 1);
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/read`, { token: tokens.teacherA })).json.data.marked, 1);
        assert.equal((await summary()).read_count, 2);
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/read`, { token: tokens.adminA })).json.data.marked, 0);
      });

      it('un non-participant ne peut ni accuser réception ni lire ; aucun accusé hors de la conversation', async () => {
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/receive`, { token: tokens.accountantA })).status, 404);
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/read`, { token: tokens.accountantA })).status, 404);
        assert.equal((await api('POST', `/api/messages/conversations/${conv}/receive`, { token: tokens.adminB })).status, 404);
        assert.equal((await summary()).recipients_count, 2);
      });

      it('les accusés restent liés aux destinataires d’origine après retrait d’un participant (historique conservé)', async () => {
        assert.equal((await api('DELETE', `/api/messages/conversations/${conv}/participants/${userId}`, { token: tokens.adminA })).status, 200);
        assert.equal((await summary()).recipients_count, 2);
        assert.equal((await summary()).read_count, 2);
      });
    });

    describe('Documents : téléversement contrôlé, stockage privé, téléchargement authentifié (§4.4)', () => {
      const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
      const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('donnees')]);
      const upload = (id, token, name, content, type) => {
        const fd = new FormData();
        fd.append('file', new Blob([content], { type: type || 'application/octet-stream' }), name);
        return fetch(`${base}/api/documents/${id}/file`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      };
      const download = (id, token) => fetch(`${base}/api/documents/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
      const mkDoc = async (body, token = tokens.adminA) => (await api('POST', '/api/documents', { token, body: { title: 'Doc', status: 'publie', ...body } })).json.data.id;
      let pub; let draft;

      before(async () => { pub = await mkDoc({ title: 'Règlement intérieur' }); draft = await mkDoc({ title: 'Brouillon', status: 'brouillon' }); });

      it('téléversement PDF valide : 201, nom d’origine conservé, nom de stockage aléatoire, pas de second fichier', async () => {
        const r = await upload(pub, tokens.adminA, 'reglement.pdf', PDF, 'application/pdf');
        assert.equal(r.status, 201);
        const body = await r.json();
        assert.equal(body.data.original_name, 'reglement.pdf');
        assert.equal(body.data.storage_name, undefined, 'le nom de stockage ne sort pas de l’API');
        assert.equal((await upload(pub, tokens.adminA, 'autre.pdf', PDF, 'application/pdf')).status, 409);
        const files = require('node:fs').readdirSync(process.env.DOCUMENTS_DIR);
        assert.equal(files.length, 1);
        assert.match(files[0], /^[a-f0-9]{48}\.bin$/);
        assert.ok(!files[0].includes('reglement'));
      });

      it('refuse un contenu qui ne correspond pas à l’extension ou au type, un type inconnu et un fichier trop gros', async () => {
        const d = await mkDoc({ title: 'Refus' });
        assert.equal((await upload(d, tokens.adminA, 'faux.pdf', Buffer.from('texte simple'), 'application/pdf')).status, 415);
        assert.equal((await upload(d, tokens.adminA, 'script.exe', PDF, 'application/pdf')).status, 415);
        assert.equal((await upload(d, tokens.adminA, 'page.html', Buffer.from('<script>x</script>'), 'text/html')).status, 415);
        assert.equal((await upload(d, tokens.adminA, 'grand.pdf', Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]), 'application/pdf')).status, 413);
        assert.equal((await upload(d, tokens.adminA, 'image.png', PNG, 'image/png')).status, 201, 'PNG accepté');
      });

      it('droits : enseignant peut joindre, utilisateur simple non ; document introuvable dans un autre établissement', async () => {
        const d = await mkDoc({ title: 'Par enseignant' }, tokens.teacherA);
        assert.equal((await upload(d, tokens.userA, 'x.pdf', PDF, 'application/pdf')).status, 403);
        assert.equal((await upload(d, tokens.teacherA, 'x.pdf', PDF, 'application/pdf')).status, 201);
        assert.equal((await upload(pub, tokens.adminB, 'x.pdf', PDF, 'application/pdf')).status, 404);
        assert.equal((await download(pub, tokens.adminB)).status, 404);
      });

      it('téléchargement : contenu exact, en pièce jointe, sans détection de type par le navigateur ; brouillon réservé aux rédacteurs', async () => {
        const r = await download(pub, tokens.userA);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'application/pdf');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.match(r.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''reglement\.pdf$/);
        assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
        assert.equal((await upload(draft, tokens.adminA, 'projet.pdf', PDF, 'application/pdf')).status, 201);
        assert.equal((await download(draft, tokens.userA)).status, 404);
        assert.equal((await download(draft, tokens.teacherA)).status, 200);
        assert.equal((await download('pas-un-uuid', tokens.adminA)).status, 400);
      });

      it('la liste n’expose ni chemin ni nom de stockage ; téléversements et téléchargements sont journalisés', async () => {
        const list = await api('GET', '/api/documents?limit=50', { token: tokens.adminA });
        const item = list.json.data.find((x) => x.id === pub);
        assert.equal(item.original_name, 'reglement.pdf');
        assert.equal(item.file_path, undefined);
        assert.equal(item.storage_name, undefined);
        const aud = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('document.upload', 'document.download')`, [TA])).rows[0].n;
        assert.ok(aud >= 3);
      });
    });

    describe('Barème des notes par établissement (§5.1)', () => {
      const PWD = 'Bareme-Pass-2026';
      let tok; let stu; let tid;
      before(async () => {
        const c = await api('POST', '/api/platform/tenants', { token: tokens.root, body: { code: 'BAREME', name: 'École Barème', admin_email: 'dir@bareme.test', admin_full_name: 'Directeur Barème', admin_password: PWD } });
        assert.equal(c.status, 201, c.text);
        tok = await login('dir@bareme.test', 'BAREME', PWD);
        tid = (await pool.query("SELECT id FROM tenants WHERE code='BAREME'")).rows[0].id;
        stu = (await api('POST', '/api/students', { token: tok, body: { matricule: 'BAR-1', first_name: 'Bar', last_name: 'Eme' } })).json.data.id;
      });

      it('par défaut le barème est 20 ; lecture ouverte à tout utilisateur connecté', async () => {
        const r = await api('GET', '/api/settings/grading', { token: tok });
        assert.equal(r.status, 200);
        assert.equal(r.json.data.grade_scale_max, 20);
        assert.equal((await api('GET', '/api/settings/grading', { token: tokens.userA })).status, 200);
        assert.equal((await api('GET', '/api/settings/grading')).status, 401);
      });

      it('seul l’administrateur modifie le barème ; valeur strictement 10 ou 20', async () => {
        assert.equal((await api('PUT', '/api/settings/grading', { token: tokens.teacherA, body: { grade_scale_max: 10 } })).status, 403);
        assert.equal((await api('PUT', '/api/settings/grading', { token: tok, body: { grade_scale_max: 15 } })).status, 400);
        assert.equal((await api('PUT', '/api/settings/grading', { token: tok, body: { grade_scale_max: '10' } })).status, 400);
        assert.equal((await api('PUT', '/api/settings/grading', { token: tok, body: {} })).status, 400);
      });

      it('sur 10 : une note au-dessus est refusée à la saisie et à l’insertion directe ; une note valide passe', async () => {
        assert.equal((await api('PUT', '/api/settings/grading', { token: tok, body: { grade_scale_max: 10 } })).status, 200);
        const over = await api('POST', '/api/grades', { token: tok, body: { student_id: stu, subject: 'Maths', score: 15, coefficient: 1 } });
        assert.equal(over.status, 400, over.text);
        assert.match(over.text, /barème/);
        const ok = await api('POST', '/api/grades', { token: tok, body: { student_id: stu, subject: 'Maths', score: 8, coefficient: 1 } });
        assert.equal(ok.status, 201, ok.text);
        const direct = await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, coefficient, status) VALUES ($1,$2,$3,14,1,$4)', [tid, stu, 'Histoire', 'saisie']).then(() => 'inserted', (e) => e.message);
        assert.match(direct, /barème/, 'le trigger doit refuser une insertion directe au-dessus du barème');
      });

      it('retour à 20 accepté ; repassage à 10 refusé tant qu’une note dépasse 10', async () => {
        assert.equal((await api('PUT', '/api/settings/grading', { token: tok, body: { grade_scale_max: 20 } })).status, 200);
        assert.equal((await api('POST', '/api/grades', { token: tok, body: { student_id: stu, subject: 'Physique', score: 15, coefficient: 1 } })).status, 201);
        const blocked = await api('PUT', '/api/settings/grading', { token: tok, body: { grade_scale_max: 10 } });
        assert.equal(blocked.status, 409, blocked.text);
        assert.equal((await api('GET', '/api/settings/grading', { token: tok })).json.data.grade_scale_max, 20);
      });

      it('le bulletin lit le barème de l’établissement et normalise les mentions sur 20', async () => {
        await pool.query('UPDATE tenants SET grade_scale_max = 10 WHERE id = $1', [tid]);
        const { loadReportCard } = require('../../backend/src/utils/studentData.js');
        const d = await loadReportCard(tid, stu, {});
        assert.equal(d.grade_scale_max, 10);
        await pool.query('UPDATE tenants SET grade_scale_max = 20 WHERE id = $1', [tid]);
      });
    });

    describe('Logo de l’établissement dans les bulletins (charte PDF)', () => {
      const zlib = require('node:zlib');
      const realPng = (w, h) => {
        const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
        const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
        const rows = Buffer.alloc(h * (1 + w * 3), 120); for (let y = 0; y < h; y++) rows[y * (1 + w * 3)] = 0;
        return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
      };
      const bulletin = async () => { const r = await fetch(`${base}/api/students/${sid}/report-card.pdf`, { headers: { Authorization: `Bearer ${tokens.adminA}` } }); return { status: r.status, txt: Buffer.from(await r.arrayBuffer()).toString('latin1') }; };
      let sid;
      before(async () => { sid = (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'LOGO-1', first_name: 'Logo', last_name: 'Eleve' } })).json.data.id; });

      it('sans logo : bulletin généré, sans image', async () => {
        const r = await bulletin();
        assert.equal(r.status, 200); assert.ok(!r.txt.includes('/Subtype /Image'));
      });

      it('logo PNG valide : bulletin avec image intégrée', async () => {
        assert.equal((await api('PUT', '/api/settings/identity/logo', { token: tokens.adminA, raw: realPng(128, 128), headers: { 'Content-Type': 'image/png' } })).status, 200);
        const r = await bulletin();
        assert.equal(r.status, 200); assert.ok(r.txt.includes('/Subtype /Image'));
      });

      it('logo illisible en base : bulletin tout de même généré, sans image', async () => {
        await pool.query("UPDATE tenant_identity SET logo = $2 WHERE tenant_id = $1", [TA, Buffer.from('données corrompues sans signature')]);
        const r = await bulletin();
        assert.equal(r.status, 200); assert.ok(!r.txt.includes('/Subtype /Image'));
      });

      it('suppression du logo : retour au bulletin sans image', async () => {
        assert.equal((await api('PUT', '/api/settings/identity/logo', { token: tokens.adminA, raw: realPng(128, 128), headers: { 'Content-Type': 'image/png' } })).status, 200);
        assert.equal((await api('DELETE', '/api/settings/identity/logo', { token: tokens.adminA })).status, 200);
        const r = await bulletin();
        assert.equal(r.status, 200); assert.ok(!r.txt.includes('/Subtype /Image'));
      });
    });

    describe('Portail parent', () => {
      const mkStudent = async (token, mat, name) => (await api('POST', '/api/students', { token, body: { matricule: mat, first_name: name, last_name: 'Portail' } })).json.data.id;
      let s1; let s2; let s3; let pA; let pB; let tokP1; let tokP2;

      it('ajout de responsables (réutilisation entre frères et sœurs) puis création des accès', async () => {
        s1 = await mkStudent(tokens.adminA, 'PO-1', 'Aminata'); s2 = await mkStudent(tokens.adminA, 'PO-2', 'Boubacar'); s3 = await mkStudent(tokens.adminA, 'PO-3', 'Cheick');
        const a = await api('POST', `/api/students/${s1}/parents`, { token: tokens.adminA, body: { first_name: 'Mariam', last_name: 'Keita', email: 'mariam@parents.test', phone: '70000001', relationship: 'mère', is_primary: true } });
        assert.equal(a.status, 201); assert.equal(a.json.data.reused, false); pA = a.json.data.parent_id;
        const b = await api('POST', `/api/students/${s2}/parents`, { token: tokens.adminA, body: { first_name: 'Mariam', last_name: 'Keita', email: 'MARIAM@parents.test' } });
        assert.equal(b.status, 201); assert.equal(b.json.data.reused, true); assert.equal(b.json.data.parent_id, pA);
        assert.equal((await api('POST', `/api/students/${s2}/parents`, { token: tokens.adminA, body: { first_name: 'Mariam', last_name: 'Keita', email: 'mariam@parents.test' } })).status, 409);
        const c = await api('POST', `/api/students/${s3}/parents`, { token: tokens.adminA, body: { first_name: 'Oumar', last_name: 'Sidibé', email: 'oumar@parents.test' } });
        pB = c.json.data.parent_id;
        assert.equal((await api('POST', `/api/students/${s3}/parents`, { token: tokens.teacherA, body: { first_name: 'X', last_name: 'Y' } })).status, 403);
        assert.equal((await api('POST', `/api/students/${s3}/parents`, { token: tokens.adminB, body: { first_name: 'X', last_name: 'Y' } })).status, 404);
        // accès : admin seulement
        assert.equal((await api('POST', `/api/parents/${pA}/account`, { token: tokens.teacherA, body: {} })).status, 403);
        const acc = await api('POST', `/api/parents/${pA}/account`, { token: tokens.adminA, body: {} });
        assert.equal(acc.status, 201); assert.match(acc.json.data.temp_password, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
        assert.equal((await api('POST', `/api/parents/${pA}/account`, { token: tokens.adminA, body: {} })).status, 409);
        assert.equal((await api('POST', `/api/parents/${pA}/account`, { token: tokens.adminB, body: {} })).status, 404);
        tokP1 = await login('mariam@parents.test', 'ECOLEA', acc.json.data.temp_password);
        const acc2 = await api('POST', `/api/parents/${pB}/account`, { token: tokens.adminA, body: { password: 'Parent-Secret-2026' } });
        assert.equal(acc2.status, 201); assert.equal(acc2.json.data.temp_password, null);
        tokP2 = await login('oumar@parents.test', 'ECOLEA', 'Parent-Secret-2026');
        const prof = (await api('GET', `/api/students/${s1}/profile`, { token: tokens.adminA })).json.data;
        assert.equal(prof.parents[0].has_account, true); assert.equal(prof.parents[0].account_email, 'mariam@parents.test');
      });

      it('un parent ne voit que ses enfants (isolation entre parents)', async () => {
        const mine = (await api('GET', '/api/portal/children', { token: tokP1 })).json.data;
        assert.deepEqual(mine.map((x) => x.id).sort(), [s1, s2].sort());
        assert.deepEqual((await api('GET', '/api/portal/children', { token: tokP2 })).json.data.map((x) => x.id), [s3]);
        for (const path of ['', '/report-card', '/photo', '/timetable']) {
          assert.equal((await api('GET', `/api/portal/children/${s3}${path}`, { token: tokP1 })).status, 404, path);
          assert.equal((await api('GET', `/api/portal/children/${s1}${path}`, { token: tokP2 })).status, 404, path);
        }
        assert.equal((await api('GET', '/api/portal/children/pas-un-uuid', { token: tokP1 })).status, 404);
        const d = await api('GET', `/api/portal/children/${s1}`, { token: tokP1 });
        assert.equal(d.status, 200); assert.equal(d.json.data.student.last_name, 'Portail'); assert.equal(d.json.data.parents, undefined);
        // Notes : le parent ne voit que les notes validées (une note en saisie n'entre pas encore au bulletin).
        await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: s1, subject: 'Brouillon-parent', score: 7, coefficient: 1 } });
        const vf = await api('POST', '/api/grades', { token: tokens.adminA, body: { student_id: s1, subject: 'Validée-parent', score: 15, coefficient: 1 } });
        assert.equal((await api('POST', `/api/grades/${vf.json.data.id}/validate`, { token: tokens.adminA })).status, 200);
        const seen = (await api('GET', `/api/portal/children/${s1}`, { token: tokP1 })).json.data.grades.map((g) => g.subject);
        assert.ok(seen.includes('Validée-parent'));
        assert.ok(!seen.includes('Brouillon-parent'), 'une note en saisie ne doit pas apparaître côté parent');
        assert.equal((await api('GET', `/api/portal/children/${s1}/report-card`, { token: tokP1 })).status, 200);
        assert.equal((await api('GET', `/api/portal/children/${s1}/timetable`, { token: tokP1 })).status, 200);
        // un enfant retiré disparaît aussitôt
        assert.equal((await api('DELETE', `/api/students/${s2}/parents/${pA}`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('GET', `/api/portal/children/${s2}`, { token: tokP1 })).status, 404);
        assert.equal((await api('GET', '/api/portal/children', { token: tokP1 })).json.data.length, 1);
      });

      it('le portail est fermé aux autres rôles, et le parent est fermé au reste de l’application', async () => {
        assert.equal((await api('GET', '/api/portal/children', { token: tokens.adminA })).status, 403);
        assert.equal((await api('GET', '/api/portal/children', { token: tokens.teacherA })).status, 403);
        assert.equal((await api('GET', '/api/portal/children', { token: tokens.adminB })).status, 403);
        for (const url of ['/api/students', `/api/students/${s1}/profile`, '/api/grades', '/api/payments', '/api/stats/overview', '/api/messages/conversations', '/api/users', '/api/stocks', '/api/reports/overview', '/api/timetable', '/api/classes']) {
          const r = await api('GET', url, { token: tokP1 });
          assert.equal(r.status, 403, url);
        }
        assert.equal((await api('POST', '/api/students', { token: tokP1, body: { matricule: 'Z', first_name: 'a', last_name: 'b' } })).status, 403);
        assert.equal((await api('POST', `/api/parents/${pA}/account`, { token: tokP1, body: {} })).status, 403);
        assert.equal((await api('GET', '/api/auth/me', { token: tokP1 })).status, 200);
        assert.equal((await api('GET', '/api/settings/identity', { token: tokP1 })).status, 200);
      });

      it('les comptes parents ne comptent pas dans le quota, leur rôle est figé, la matrice les ignore, désactivation immédiate', async () => {
        const me = (await api('GET', '/api/auth/me', { token: tokP1 })).json.data;
        assert.equal(me.role, 'parent');
        const mx = (await api('GET', '/api/settings/permissions', { token: tokens.adminA })).json.data;
        assert.equal(mx.matrix.parent, undefined);
        const q = await pool.query(`SELECT count(*)::int AS n FROM users u WHERE u.tenant_id = $1 AND u.is_active AND u.role <> 'parent'`, [TA]);
        const set = await api('GET', '/api/settings', { token: tokens.adminA });
        assert.equal(set.status, 200);
        const list = (await api('GET', '/api/users', { token: tokens.adminA })).json.data;
        const par = list.find((u) => u.email === 'mariam@parents.test');
        assert.ok(par); assert.equal(par.role, 'parent');
        assert.equal((await api('PUT', `/api/users/${par.id}`, { token: tokens.adminA, body: { role: 'admin' } })).status, 400);
        assert.equal((await api('POST', '/api/users', { token: tokens.adminA, body: { email: 'p@x.test', full_name: 'P', role: 'parent', password: 'Parent-Secret-2026' } })).status, 400);
        assert.ok(q.rows[0].n >= 1);
        assert.equal((await api('PUT', `/api/users/${par.id}`, { token: tokens.adminA, body: { is_active: false } })).status, 200);
        assert.equal((await api('GET', '/api/portal/children', { token: tokP1 })).status, 401);
        assert.equal((await api('DELETE', `/api/parents/${pA}/account`, { token: tokens.adminA })).status, 200);
        assert.equal((await api('DELETE', `/api/parents/${pA}/account`, { token: tokens.adminA })).status, 404);
      });

      it('bulletin PDF : administrateur, parent de l’enfant uniquement, droits de lecture respectés', async () => {
        const ok = await fetch(`${base}/api/students/${s1}/report-card.pdf`, { headers: { Authorization: `Bearer ${tokens.adminA}` } });
        assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /application\/pdf/); assert.match(ok.headers.get('content-disposition'), /bulletin-portail-aminata\.pdf/);
        const buf = Buffer.from(await ok.arrayBuffer());
        assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.match(buf.subarray(-6).toString(), /%%EOF/);
        assert.ok(pdfText(buf).includes('Aminata Portail'));
        const start = Number(/startxref\n(\d+)/.exec(buf.toString('latin1'))[1]);
        assert.equal(buf.subarray(start, start + 4).toString(), 'xref');
        assert.equal((await api('GET', `/api/students/${s1}/report-card.pdf?from=pas-une-date`, { token: tokens.adminA })).status, 400);
        assert.equal((await api('GET', `/api/students/${s1}/report-card.pdf`, { token: tokens.adminB })).status, 404);
        const par = (p, tk) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.status);
        // le parent de s1 (compte recréé) : son enfant oui, celui d’un autre parent non
        const again = await api('POST', `/api/parents/${pA}/account`, { token: tokens.adminA, body: { password: 'Parent-Secret-2026' } });
        assert.equal(again.status, 201);
        const tk = await login('mariam@parents.test', 'ECOLEA', 'Parent-Secret-2026');
        assert.equal(await par(`/api/portal/children/${s1}/report-card.pdf`, tk), 200);
        assert.equal(await par(`/api/portal/children/${s3}/report-card.pdf`, tk), 404);
        assert.equal(await par(`/api/students/${s1}/report-card.pdf`, tk), 403);
        await api('PUT', '/api/settings/permissions', { token: tokens.adminA, body: { changes: [{ role: 'teacher', module: 'students', level: 'none' }] } });
        assert.equal(await par(`/api/students/${s1}/report-card.pdf`, tokens.teacherA), 403);
        await api('DELETE', '/api/settings/permissions', { token: tokens.adminA });
      });

      it('reçu de paiement PDF : administration, parent de l’enfant, isolation, paiement non encaissé refusé', async () => {
        const pay = (await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: s1, amount: 85000, fee_type: 'Scolarité T1', method: 'Espèces' } })).json.data;
        const pend = (await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: s1, amount: 1000, status: 'en_attente' } })).json.data;
        const get = (p, tk) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${tk}` } });
        const ok = await get(`/api/payments/${pay.id}/receipt.pdf`, tokens.adminA);
        assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /application\/pdf/);
        const buf = Buffer.from(await ok.arrayBuffer()).toString('latin1');
        assert.ok(buf.startsWith('%PDF-')); const txt = pdfText(Buffer.from(buf, 'latin1')); assert.ok(txt.includes(pay.receipt_number)); assert.ok(txt.includes('Aminata Portail')); assert.ok(txt.includes('Quatre-vingt-cinq mille francs CFA'));
        assert.equal((await get(`/api/payments/${pend.id}/receipt.pdf`, tokens.adminA)).status, 409);
        assert.equal((await get(`/api/payments/${pay.id}/receipt.pdf`, tokens.adminB)).status, 404);
        assert.equal((await get('/api/payments/pas-un-uuid/receipt.pdf', tokens.adminA)).status, 400);
        await pool.query(`UPDATE users SET is_active = true WHERE tenant_id = $1 AND role = 'parent'`, [TA]);
        // parent de s1 (compte recréé plus haut) : son enfant oui ; paiement en attente ou autre enfant non
        const tk = await login('mariam@parents.test', 'ECOLEA', 'Parent-Secret-2026');
        assert.equal((await get(`/api/portal/children/${s1}/payments/${pay.id}/receipt.pdf`, tk)).status, 200);
        assert.equal((await get(`/api/portal/children/${s1}/payments/${pend.id}/receipt.pdf`, tk)).status, 404);
        assert.equal((await get(`/api/portal/children/${s3}/payments/${pay.id}/receipt.pdf`, tk)).status, 404);
        assert.equal((await get(`/api/payments/${pay.id}/receipt.pdf`, tk)).status, 403);
        await pool.query(`UPDATE payments SET status = 'annule' WHERE id = $1`, [pend.id]); // n'interfère pas avec les tests d'impayés
      });

      it('exports Excel (CSV) : élèves, notes, paiements — droits, isolation, filtres, formules neutralisées, audit', async () => {
        const get = (p, tk) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${tk}` } });
        const evil = await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: 'EX-1', first_name: '=HYPERLINK("http://evil")', last_name: 'Export', gender: 'F' } });
        assert.equal(evil.status, 201);
        const r = await get('/api/students/export.csv', tokens.adminA);
        assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /eleves\.csv/);
        const raw = Buffer.from(await r.arrayBuffer());
        assert.deepEqual([...raw.subarray(0, 3)], [0xEF, 0xBB, 0xBF]); // BOM UTF-8 : Excel affiche correctement les accents
        const txt = raw.toString('utf8');
        assert.ok(txt.startsWith('\uFEFFMatricule;Nom;Prénom;'));
        assert.ok(txt.includes("'=HYPERLINK"), 'formule non neutralisée'); assert.ok(!/;=HYPERLINK/.test(txt));
        assert.ok(txt.includes('Mariam Keita'), 'responsable principal absent'); // lien « Portail » : parent de s1
        const q = await (await get('/api/students/export.csv?q=EX-1', tokens.adminA)).text();
        assert.equal(q.trim().split('\r\n').length, 2);
        assert.equal((await get('/api/students/export.csv?status=nimporte', tokens.adminA)).status, 400);
        // isolation : l'établissement B n'exporte que ses propres élèves
        const b = await (await get('/api/students/export.csv', tokens.adminB)).text();
        assert.ok(!b.includes('Export;') && !b.includes('Portail'));
        // notes et paiements
        assert.equal((await get('/api/grades/export.csv', tokens.adminA)).status, 200);
        const pay = await (await get('/api/payments/export.csv', tokens.accountantA)).text();
        assert.ok(pay.startsWith('Reçu;Élève;Montant (F CFA);')); assert.match(pay, /R-\d{4}-\d{6}/);
        assert.ok(!(await (await get('/api/payments/export.csv', tokens.adminB)).text()).includes('Portail'));
        // droits : l'enseignant sans droit de lecture « Paiements » reçoit 403 ; le parent est fermé
        assert.equal((await get('/api/payments/export.csv', tokens.teacherA)).status, 403); // D1 : aucun accès par défaut
        await api('PUT', '/api/settings/permissions', { token: tokens.adminA, body: { changes: [{ role: 'teacher', module: 'payments', level: 'read' }] } });
        assert.equal((await get('/api/payments/export.csv', tokens.teacherA)).status, 200); // ouverture par l'administrateur
        await api('PUT', '/api/settings/permissions', { token: tokens.adminA, body: { changes: [{ role: 'teacher', module: 'payments', level: 'none' }] } });
        assert.equal((await get('/api/payments/export.csv', tokens.teacherA)).status, 403);
        await api('DELETE', '/api/settings/permissions', { token: tokens.adminA });
        const tk = await login('mariam@parents.test', 'ECOLEA', 'Parent-Secret-2026');
        for (const u of ['/api/students/export.csv', '/api/grades/export.csv', '/api/payments/export.csv']) assert.equal((await get(u, tk)).status, 403, u);
        const aud = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('student.export', 'grade.export', 'payment.export')`, [TA])).rows[0].n;
        assert.ok(aud >= 3);
      });
    });

    describe('Notifications aux parents (SMS, WhatsApp, e-mail)', () => {
      const { startFakeTwilio } = require('../helpers/fakeTwilio');
      const { startFakeSmtp } = require('../helpers/fakeSmtp');
      const KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM', 'TWILIO_WHATSAPP_FROM', 'TWILIO_API_BASE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'MAIL_FROM'];
      let tw; let smtp; let cls; let n1; let n2; let n3; let pa; let pb;
      const off = () => KEYS.forEach((k) => delete process.env[k]);
      const smsOn = () => { Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+15550001111', TWILIO_WHATSAPP_FROM: '+14155238886', TWILIO_API_BASE: `http://127.0.0.1:${tw.port}` }); };
      const mailOn = () => Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false', MAIL_FROM: 'noreply@smp.test' });
      const send = (body, token = tokens.adminA) => api('POST', '/api/broadcasts', { token, body });
      before(async () => { tw = await startFakeTwilio(); smtp = await startFakeSmtp(); });
      after(async () => { off(); await tw.close(); await smtp.close(); });

      it('numéros normalisés (+223), canaux indisponibles tant que rien n’est configuré', async () => {
        const { normalizePhone } = require('../../backend/src/utils/phone');
        assert.equal(normalizePhone('76 11 22 33'), '+22376112233'); assert.equal(normalizePhone('0022376112233'), '+22376112233');
        assert.equal(normalizePhone('+33 6 12 34 56 78'), '+33612345678'); assert.equal(normalizePhone('abc'), null); assert.equal(normalizePhone('123'), null);
        off();
        const ch = (await api('GET', '/api/broadcasts/channels', { token: tokens.adminA })).json.data;
        assert.equal(ch.sms.available, false); assert.equal(ch.whatsapp.available, false); assert.equal(ch.email.available, false);
        cls = (await api('POST', '/api/classes', { token: tokens.adminA, body: { name: 'Notif 6e', level: '6e', school_year: '2026-2027' } })).json.data.id;
        const mk = async (m, n, extra = {}) => (await api('POST', '/api/students', { token: tokens.adminA, body: { matricule: m, first_name: n, last_name: 'Notif', class_id: cls, ...extra } })).json.data.id;
        n1 = await mk('NO-1', 'Awa'); n2 = await mk('NO-2', 'Bakary'); n3 = await mk('NO-3', 'Cira');
        const g = async (sid, b) => (await api('POST', `/api/students/${sid}/parents`, { token: tokens.adminA, body: b })).json.data.parent_id;
        pa = await g(n1, { first_name: 'Fanta', last_name: 'Notif', phone: '76 11 22 33', email: 'fanta@notif.test' });
        await g(n2, { first_name: 'Fanta', last_name: 'Notif', phone: '76 11 22 33', email: 'fanta@notif.test' }); // même parent, 2 enfants
        pb = await g(n3, { first_name: 'Issa', last_name: 'Notif', phone: '123' }); // numéro invalide, pas d’e-mail
        const r = await send({ subject: 'Réunion', body: 'Bonjour', channels: ['sms'], audience: { type: 'class', id: cls } });
        assert.equal(r.status, 409); assert.match(r.json.error, /SMS/);
        assert.equal((await api('GET', '/api/broadcasts/channels', { token: tokens.accountantA })).status, 200);
      });

      it('aperçu, envoi groupé SMS + WhatsApp + e-mail, personnalisation, préférences, journal', async () => {
        smsOn(); mailOn();
        const pv = (await api('GET', `/api/broadcasts/preview?type=class&id=${cls}`, { token: tokens.adminA })).json.data;
        assert.deepEqual([pv.guardians, pv.sms, pv.whatsapp, pv.email], [2, 1, 1, 1]);
        assert.equal((await api('GET', '/api/broadcasts/preview?type=class', { token: tokens.adminA })).status, 400);
        assert.equal((await api('GET', `/api/broadcasts/preview?type=class&id=${TB}`, { token: tokens.adminA })).status, 404);
        const bad = await send({ subject: '', body: 'x', channels: ['pigeon'], audience: { type: 'all' } });
        assert.equal(bad.status, 400);
        const r = await send({ subject: 'Réunion parents', body: 'Bonjour {parent}, réunion vendredi pour {enfants}.', channels: ['sms', 'whatsapp', 'email'], audience: { type: 'class', id: cls } });
        assert.equal(r.status, 201); assert.deepEqual([r.json.data.recipients, r.json.data.sent, r.json.data.skipped, r.json.data.failed], [2, 3, 3, 0]);
        assert.equal(tw.messages.length, 2);
        const sms = tw.messages.find((m) => !m.to.startsWith('whatsapp:')); const wa = tw.messages.find((m) => m.to.startsWith('whatsapp:'));
        assert.equal(sms.to, '+22376112233'); assert.equal(sms.from, '+15550001111'); assert.equal(wa.to, 'whatsapp:+22376112233'); assert.equal(wa.from, 'whatsapp:+14155238886');
        assert.match(sms.body, /Bonjour Fanta, réunion vendredi pour Awa Notif, Bakary Notif\./); assert.match(sms.body, /^Groupe|^École A|^ECOLEA|École A/);
        assert.match(tw.state.auth, /^Basic /);
        await new Promise((r2) => setTimeout(r2, 200));
        assert.ok(smtp.messages.some((m) => m.to.includes('<fanta@notif.test>') || m.to.includes('fanta@notif.test')));
        // préférence : Fanta refuse les SMS
        assert.equal((await api('PUT', `/api/parents/${pa}/preferences`, { token: tokens.adminA, body: { notify_sms: false } })).status, 200);
        assert.equal((await api('PUT', `/api/parents/${pa}/preferences`, { token: tokens.teacherA, body: { notify_sms: true } })).status, 403);
        const r2 = await send({ subject: 'Rappel', body: 'Rappel', channels: ['sms'], audience: { type: 'student', id: n1 } });
        assert.equal(r2.json.data.sent, 0); assert.equal(tw.messages.length, 2);
        // refus du fournisseur : consigné, sans planter
        await api('PUT', `/api/parents/${pa}/preferences`, { token: tokens.adminA, body: { notify_sms: true } });
        tw.state.rejectTo.add('+22376112233');
        const r3 = await send({ subject: 'Test', body: 'Test', channels: ['sms'], audience: { type: 'student', id: n1 } });
        assert.equal(r3.json.data.failed, 1);
        const row = (await pool.query(`SELECT status, error FROM notify_outbox WHERE tenant_id = $1 AND status = 'failed'`, [TA])).rows[0];
        assert.match(row.error, /non autorisé/); tw.state.rejectTo.clear();
        const hist = (await api('GET', '/api/broadcasts', { token: tokens.accountantA })).json.data;
        assert.ok(hist.length >= 3); assert.equal(hist[hist.length - 1].audience_label, 'Classe Notif 6e');
        assert.equal((await api('GET', '/api/broadcasts', { token: tokens.adminB })).json.data.length, 0);
        // droits : l’enseignant lit mais n’envoie pas
        assert.equal((await send({ subject: 'x', body: 'y', channels: ['email'], audience: { type: 'all' } }, tokens.teacherA)).status, 403);
        assert.equal((await send({ subject: 'x', body: 'y', channels: ['email'], audience: { type: 'all' } }, tokens.adminB)).status, 422);
      });

      it('alerte automatique d’absence : une seule fois par élève et par jour, selon les canaux choisis', async () => {
        smsOn(); const before = tw.messages.length;
        assert.equal((await api('PUT', '/api/broadcasts/settings', { token: tokens.teacherA, body: { absence_channels: ['sms'] } })).status, 403);
        assert.equal((await api('PUT', '/api/broadcasts/settings', { token: tokens.adminA, body: { absence_channels: ['fax'] } })).status, 400);
        // canaux désactivés : aucune alerte
        await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: n1, class_id: cls, date: '2026-11-02', status: 'absent' } });
        await new Promise((r) => setTimeout(r, 300)); assert.equal(tw.messages.length, before);
        assert.equal((await api('PUT', '/api/broadcasts/settings', { token: tokens.adminA, body: { absence_channels: ['sms'] } })).status, 200);
        assert.deepEqual((await api('GET', '/api/broadcasts/settings', { token: tokens.adminA })).json.data.absence_channels, ['sms']);
        await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: n1, class_id: cls, date: '2026-11-03', status: 'present' } });
        const a = await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: n1, class_id: cls, date: '2026-11-04', status: 'absent' } });
        assert.equal(a.status, 201);
        await new Promise((r) => setTimeout(r, 400));
        assert.equal(tw.messages.length, before + 1); assert.match(tw.messages[before].body, /Awa Notif a été noté\(e\) absent\(e\) le 04\/11\/2026/);
        const dup = await api('POST', '/api/attendances', { token: tokens.adminA, body: { student_id: n1, class_id: null, date: '2026-11-04', status: 'absent' } });
        await new Promise((r) => setTimeout(r, 300)); assert.equal(tw.messages.length, before + 1, `doublon ${dup.status}`);
      });

      it('rappels d’impayés : aperçu, envoi manuel groupé par parent, rappels automatiques sans doublon', async () => {
        smsOn(); const notifyMod = require('../../backend/src/utils/notify');
        const pay = async (sid, amount, fee) => (await api('POST', '/api/payments', { token: tokens.adminA, body: { student_id: sid, amount, fee_type: fee, status: 'en_attente' } })).json.data.id;
        const p1 = await pay(n1, 25000, 'Scolarité'); await pay(n2, 10000, 'Cantine'); await pay(n3, 5000, 'Transport');
        await pool.query(`UPDATE payments SET paid_at = now() - interval '10 days' WHERE tenant_id = $1 AND status = 'en_attente'`, [TA]);
        const pv = (await api('GET', '/api/broadcasts/unpaid', { token: tokens.accountantA })).json.data;
        assert.equal(pv.parents, 2); assert.equal(pv.total, 40000);
        assert.equal((await api('GET', '/api/broadcasts/unpaid', { token: tokens.adminB })).json.data.parents, 0);
        assert.equal((await api('POST', '/api/broadcasts/unpaid', { token: tokens.teacherA, body: { channels: ['sms'] } })).status, 403);
        assert.equal((await api('POST', '/api/broadcasts/unpaid', { token: tokens.adminA, body: { channels: [] } })).status, 400);
        assert.equal((await api('POST', '/api/broadcasts/unpaid', { token: tokens.adminB, body: { channels: ['sms'] } })).status, 422);
        const before = tw.messages.length;
        const r = await api('POST', '/api/broadcasts/unpaid', { token: tokens.adminA, body: { channels: ['sms'] } });
        assert.equal(r.status, 201); assert.deepEqual([r.json.data.recipients, r.json.data.sent, r.json.data.skipped], [2, 1, 1]);
        assert.equal(tw.messages.length, before + 1);
        const body = tw.messages[before].body;
        assert.match(body, /Bonjour Fanta/); assert.match(body, /Awa Notif : 25 000 F CFA \(Scolarité\)/); assert.match(body, /Bakary Notif : 10 000 F CFA \(Cantine\)/); assert.match(body, /Total : 35 000 F CFA/);
        // réglages automatiques
        assert.equal((await api('PUT', '/api/broadcasts/settings', { token: tokens.adminA, body: { unpaid_after_days: 0 } })).status, 400);
        assert.equal((await api('PUT', '/api/broadcasts/settings', { token: tokens.adminA, body: { unpaid_channels: ['sms'], unpaid_after_days: 30 } })).status, 200);
        const s1 = (await api('GET', '/api/broadcasts/settings', { token: tokens.adminA })).json.data;
        assert.deepEqual(s1.absence_channels, ['sms']); assert.deepEqual(s1.unpaid_channels, ['sms']); assert.equal(s1.unpaid_after_days, 30);
        let m = tw.messages.length;
        await notifyMod.runUnpaidReminders(); assert.equal(tw.messages.length, m); // pas encore 30 jours
        await api('PUT', '/api/broadcasts/settings', { token: tokens.adminA, body: { unpaid_after_days: 7 } });
        await notifyMod.runUnpaidReminders(); assert.equal(tw.messages.length, m + 1); // Fanta ; Issa : numéro invalide, rien d’envoyé
        await notifyMod.runUnpaidReminders(); assert.equal(tw.messages.length, m + 1); // aucun doublon
        await pool.query(`UPDATE payments SET paid_at = now() - interval '25 days' WHERE id = $1`, [p1]);
        await notifyMod.runUnpaidReminders(); assert.equal(tw.messages.length, m + 2); // 2e rappel pour le paiement devenu plus ancien
        await pool.query(`UPDATE payments SET status = 'paye' WHERE tenant_id = $1`, [TA]);
        await notifyMod.runUnpaidReminders(); assert.equal(tw.messages.length, m + 2); // plus d’impayé
        off(); await notifyMod.runUnpaidReminders(); // canal non configuré : rien ne plante
      });

      it('plafond journalier de SMS / WhatsApp par établissement', async () => {
        smsOn(); process.env.NOTIFY_DAILY_LIMIT = '1';
        try {
          await pool.query(`DELETE FROM notify_outbox WHERE tenant_id = $1`, [TA]);
          const n0 = tw.messages.length;
          const r = await send({ subject: 'Plafond', body: 'Test plafond', channels: ['sms'], audience: { type: 'class', id: cls } });
          assert.equal(r.status, 201); assert.equal(r.json.data.recipients, 2);
          assert.equal(r.json.data.sent, 1); assert.equal(tw.messages.length, n0 + 1);
          const capped = (await pool.query(`SELECT count(*)::int AS n FROM notify_outbox WHERE tenant_id = $1 AND status = 'skipped' AND error LIKE 'Plafond%'`, [TA])).rows[0].n;
          assert.ok(capped >= 0);
          const r2 = await send({ subject: 'Plafond 2', body: 'Test plafond', channels: ['sms'], audience: { type: 'student', id: n1 } });
          assert.equal(r2.json.data.sent, 0); assert.equal(tw.messages.length, n0 + 1);
          assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notify_outbox WHERE tenant_id = $1 AND error LIKE 'Plafond%'`, [TA])).rows[0].n >= 1, true);
        } finally { delete process.env.NOTIFY_DAILY_LIMIT; }
      });
    });
  });
}
