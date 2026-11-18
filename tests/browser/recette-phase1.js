// Recette navigateur Phase 1 (grades, corrections, périodes, tableau de bord par rôle).
// Prérequis : serveur démarré sur http://127.0.0.1:3100 avec une base de test (_test) et les comptes de recette ;
// Playwright installé (require('playwright')). Lancer : node tests/browser/recette-phase1.js
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';
const results = [];
const check = (label, ok, extra = '') => { results.push({ label, ok }); console.log(`${ok ? 'OK ' : 'KO '} ${label}${extra ? ' — ' + extra : ''}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function tokenOf(email, pwd) { return (await api('POST', '/api/auth/login', null, { email, password: pwd, tenant_code: 'ECOLEA' })).json.data.token; }
async function login(browser, email, pwd) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('input[name=tenant_code]', 'ECOLEA'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pwd);
  await page.click('#login-submit');
  await page.waitForFunction(() => document.querySelector('#login-overlay')?.classList.contains('hidden'), null, { timeout: 15000 });
  return { page, errors };
}
async function modalFill(page, values) {
  for (const [name, v] of Object.entries(values)) await page.fill(`#modal-form [name=${name}]`, String(v));
  await page.click('#modal-form button:not([type=button])');
  await page.waitForTimeout(900);
}
(async () => {
  const admin = await tokenOf('admin@a.test', 'Motdepasse-123');
  const teacher = await tokenOf('prof@a.test', 'Motdepasse-123');
  const gerant = await tokenOf('gerant@a.test', 'Gerant-Pass-2026');
  // Données de recette
  const stu = (await api('POST', '/api/students', admin, { matricule: 'REC-' + Date.now(), first_name: 'Recette', last_name: 'Navigateur' })).json.data.id;
  const gSaisie = (await api('POST', '/api/grades', teacher, { student_id: stu, subject: 'Recette-saisie', score: 11, coefficient: 1 })).json.data.id;
  const gValid = (await api('POST', '/api/grades', teacher, { student_id: stu, subject: 'Recette-validee', score: 12, coefficient: 1 })).json.data.id;
  await api('POST', `/api/grades/${gValid}/validate`, admin);
  const period = (await api('POST', '/api/periods', admin, { name: 'REC-' + Date.now().toString().slice(-5), start_date: '2025-07-01', end_date: '2025-07-31' })).json.data.id;

  const browser = await chromium.launch();
  // 1. Enseignant : demande de correction puis retrait à l'écran
  const T = await login(browser, 'prof@a.test', 'Motdepasse-123');
  await T.page.click('nav [data-module="grades"]'); await T.page.waitForTimeout(900);
  await T.page.fill('#module-q', 'Recette').catch(() => {}); await T.page.keyboard.press('Enter').catch(() => {}); await T.page.waitForTimeout(700);
  const rowV = T.page.locator('tr', { hasText: 'Recette-validee' });
  check('enseignant : la note validée affiche « Corriger »', await rowV.locator('button[data-act=correct]').count() === 1);
  await rowV.locator('button[data-act=correct]').click(); await T.page.waitForTimeout(500);
  await modalFill(T.page, { score: 14, reason: 'Erreur de saisie recette' });
  check('enseignant : la demande est enregistrée côté serveur', (await api('GET', '/api/grades/corrections/mine', teacher)).json.data.some((c) => c.grade_id === gValid));
  await T.page.waitForTimeout(600);
  const rowV2 = T.page.locator('tr', { hasText: 'Recette-validee' });
  check('enseignant : la ligne propose « Retirer ma demande »', await rowV2.locator('button[data-act=withdraw]').count() === 1);
  await rowV2.locator('button[data-act=withdraw]').click(); await T.page.waitForTimeout(500);
  await modalFill(T.page, { reason: 'Retrait recette' });
  const mineAfter = (await api('GET', '/api/grades/corrections/mine', teacher)).json.data;
  check('enseignant : retrait effectif côté serveur', !mineAfter.some((c) => c.grade_id === gValid));
  check('enseignant : aucune erreur JavaScript', T.errors.length === 0, T.errors.join(' | '));

  // 2. Administrateur : validation d'une note en saisie, puis approbation d'une correction
  const A = await login(browser, 'admin@a.test', 'Motdepasse-123');
  await A.page.click('nav [data-module="grades"]'); await A.page.waitForTimeout(900);
  await A.page.fill('#module-q', 'Recette').catch(() => {}); await A.page.keyboard.press('Enter').catch(() => {}); await A.page.waitForTimeout(700);
  const rowS = A.page.locator('tr', { hasText: 'Recette-saisie' });
  check('administrateur : la note en saisie propose « Valider »', await rowS.locator('button[data-act=validate]').count() === 1);
  await rowS.locator('button[data-act=validate]').click(); await A.page.waitForTimeout(900);
  const gradesNow = (await api('GET', `/api/grades?student_id=${stu}`, admin)).json.data;
  check('administrateur : la note est validée côté serveur', gradesNow.find((g) => g.id === gSaisie).status === 'validee');
  // Nouvelle demande de l'enseignant, décidée par l'administrateur depuis Paramètres
  await api('POST', `/api/grades/${gValid}/corrections`, teacher, { score: 15, reason: 'Correction pour approbation' });
  await A.page.click('nav [data-module="settings"]'); await A.page.waitForTimeout(1200);
  const approve = A.page.locator('#corrections-list [data-correction-approve]').first();
  check('administrateur : la demande apparaît avec « Approuver »', await approve.count() >= 1);
  await approve.click(); await A.page.waitForTimeout(500);
  await modalFill(A.page, { reason: 'Vérifié sur la copie' });
  const after = (await api('GET', `/api/grades?student_id=${stu}`, admin)).json.data.find((g) => g.id === gValid);
  check('administrateur : approbation applique la nouvelle note', Number(after.score) === 15, `score=${after.score}`);

  // 3. Période : clôture par l'administrateur, verrouillage, réouverture par le gérant
  await A.page.waitForTimeout(500);
  const pRow = A.page.locator('#periods-list div', { hasText: 'du 01/07/2025' }).first();
  await pRow.locator('[data-period-close]').click(); await A.page.waitForTimeout(500);
  const okBtn = A.page.locator('[data-modal-ok]'); if (await okBtn.count()) await okBtn.click();
  await A.page.waitForTimeout(900);
  const closedNow = (await api('GET', '/api/periods', admin)).json.data.find((p) => p.start_date === '2025-07-01');
  check('administrateur : clôture effective', !!closedNow && !!closedNow.closed_at);
  check('verrouillage : nouvelle note dans la période refusée', (await api('POST', '/api/grades', teacher, { student_id: stu, subject: 'Hors', score: 9, date: '2025-07-15' })).status === 409);
  check('administrateur : aucune erreur JavaScript', A.errors.length === 0, A.errors.join(' | '));

  const G = await login(browser, 'gerant@a.test', 'Gerant-Pass-2026');
  await G.page.click('nav [data-module="settings"]'); await G.page.waitForTimeout(1200);
  const gRow = G.page.locator('#periods-list div', { hasText: 'du 01/07/2025' }).first();
  check('gérant : période clôturée propose « Rouvrir »', await gRow.locator('[data-period-reopen]').count() === 1);
  await gRow.locator('[data-period-reopen]').click(); await G.page.waitForTimeout(500);
  await modalFill(G.page, { reason: 'Rectification gérant recette' });
  const reopened = (await api('GET', '/api/periods', admin)).json.data.find((p) => p.start_date === '2025-07-01');
  check('gérant : réouverture effective', !!reopened && !reopened.closed_at);
  check('gérant : section Utilisateurs absente', await G.page.locator('#users-rows').count() === 0);

  // 4. Tableau de bord par rôle
  for (const [label, ctx] of [['administrateur', A], ['enseignant', T], ['gérant', G]]) {
    await ctx.page.click('nav [data-module="dashboard"]'); await ctx.page.waitForTimeout(1200);
    const t = (await ctx.page.textContent('main')) || '';
    check(`${label} : tableau de bord chargé sans erreur`, ctx.errors.length === 0 && t.length > 50, ctx.errors.join(' | '));
  }
  await browser.close();
  const ko = results.filter((r) => !r.ok).length;
  console.log(`\nRésultat : ${results.length - ko}/${results.length} vérifications OK`);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
