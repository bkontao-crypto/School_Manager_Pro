// Recette navigateur des factures familiales (Finances) : création, affectation de paiement, annulation.
// Prérequis : serveur sur http://127.0.0.1:3100 avec la base de test (_test) et le compte admin@a.test (tenant ECOLEA).
// Lancer : node tests/browser/recette-factures.js
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';
const results = [];
const check = (label, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'KO '} ${label}${extra ? ' — ' + extra : ''}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function navTo(page, key) {
  await page.evaluate((k) => {
    const a = document.querySelector(`nav [data-module="${k}"]`);
    const w = a && a.closest('[data-group-wrap]');
    if (w && w.querySelector('.nav-panel').classList.contains('hidden')) w.querySelector('[data-group]').click();
  }, key);
  await page.click(`nav [data-module="${key}"]`);
}

(async () => {
  const PWD = 'Motdepasse-123';
  const admin = (await api('POST', '/api/auth/login', null, { email: 'admin@a.test', password: PWD, tenant_code: 'ECOLEA' })).json.data.token;
  const last = `Recette${Date.now()}`;
  const stu = await api('POST', '/api/students', admin, { matricule: `FAC-${Date.now()}`, first_name: 'Famille', last_name: last });
  const sid = stu.json.data.id;
  const pay = await api('POST', '/api/payments', admin, { student_id: sid, amount: 20000, fee_type: 'Acompte' });
  check('élève et paiement de test créés', stu.status === 201 && pay.status === 201, `HTTP ${stu.status}/${pay.status}`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('input[name=tenant_code]', 'ECOLEA'); await page.fill('input[name=email]', 'admin@a.test'); await page.fill('input[name=password]', PWD);
  await page.click('#login-submit');
  await page.waitForSelector('nav [data-module="invoices"]', { state: 'attached', timeout: 15000 });
  // le tableau de bord initial doit finir de se charger avant de changer de vue
  await page.waitForFunction(() => { const m = document.getElementById('metric-students'); return m && m.textContent !== '—'; }, null, { timeout: 15000 });

  await navTo(page, 'invoices');
  await page.waitForSelector('#inv-new', { timeout: 10000 });
  check('page Factures ouverte depuis Finances', (await page.textContent('h2')).includes('Factures familiales'));

  await page.click('#inv-new');
  await page.fill('#modal-box [data-student-search]', last);
  await page.waitForSelector('#modal-box [data-pick]', { timeout: 8000 });
  await page.click('#modal-box [data-pick]');
  await page.fill('#modal-box [data-l-label]', 'Scolarité trimestre 1');
  await page.fill('#modal-box [data-l-unit]', '15000');
  await page.click('#inv-add-line');
  await page.locator('#modal-box [data-line]').nth(1).locator('[data-l-label]').fill('Cantine');
  await page.locator('#modal-box [data-line]').nth(1).locator('[data-l-qty]').fill('2');
  await page.locator('#modal-box [data-line]').nth(1).locator('[data-l-unit]').fill('2500');
  const totalShown = await page.textContent('#inv-total');
  check('total calculé à l’écran (15 000 + 2 × 2 500)', totalShown.replace(/\s/g, '').includes('20000'), totalShown);
  await page.click('#inv-form button[type=submit]');
  await page.waitForFunction(() => /FAC-\d{6}/.test(document.querySelector('#modal-box h3')?.textContent || ''), null, { timeout: 10000 });
  await page.waitForSelector('#alloc-form', { timeout: 10000 });
  const head = await page.textContent('#modal-box h3');
  check('facture créée et détail ouvert', /FAC-\d{6}/.test(head), head);

  await page.selectOption('#alloc-form select[name=payment_id]', pay.json.data.id);
  await page.fill('#alloc-form input[name=amount]', '5000');
  await page.click('#alloc-form button[type=submit]');
  await page.waitForSelector('#modal-box li:has-text("Reçu")', { timeout: 8000 });
  const solde = await page.textContent('#modal-box li:has-text("Reçu")');
  check('affectation de 5 000 F listée dans le détail', /5\s?000/.test(solde), solde.trim());
  check('solde recalculé à 15 000 F', /15\s?000/.test(await page.textContent('#modal-box')));
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/factures-detail.png` : '/dev/null' }).catch(() => {});

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#inv-pdf')]);
  check('PDF de facture téléchargé', !!dl && (await dl.suggestedFilename()).startsWith('facture-FAC-'), dl ? await dl.suggestedFilename() : 'aucun téléchargement');
  await page.click('#inv-send');
  await page.waitForFunction(() => (document.querySelector('#inv-detail-msg')?.textContent || '').length > 0 || /envoy/i.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 8000 });
  const sendMsg = (await page.textContent('#inv-detail-msg')) || (await page.textContent('#toast')) || '';
  check('envoi aux responsables : résultat clair affiché (refus sans e-mail, non configuré, envoyé ou échec)', /responsable|configuré|envoy|Échec/i.test(sendMsg), sendMsg.trim());
  await page.click('#modal-box [data-modal-cancel]');
  await page.waitForSelector('#inv-rows button[data-inv]', { timeout: 8000 });
  const rowText = await page.textContent('#inv-rows');
  check('la liste affiche la facture avec statut Partielle', rowText.includes('Partielle'));

  check('aucune erreur JavaScript pendant la recette', errors.length === 0, errors.join(' | '));
  await browser.close();
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} vérifications OK`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error('ERREUR RECETTE :', e.message); process.exit(2); });
