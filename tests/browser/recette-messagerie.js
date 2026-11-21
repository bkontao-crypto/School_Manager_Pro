// Le menu regroupe les modules sous des rubriques repliées : on ouvre la rubrique comme le ferait un utilisateur.
async function navTo(page, key) {
  await page.evaluate((k) => {
    const a = document.querySelector(`nav [data-module="${k}"]`);
    const w = a && a.closest('[data-group-wrap]');
    if (w && w.querySelector('.nav-panel').classList.contains('hidden')) w.querySelector('[data-group]').click();
  }, key);
  await page.click(`nav [data-module="${key}"]`);
}
// Recette navigateur de la messagerie côté destinataire (ordonnance §4.1 point 6, §8.4).
// Prérequis : serveur sur http://127.0.0.1:3100 avec la base de test (_test) et les comptes de recette
// (admin@a.test, prof@a.test). Lancer : node tests/browser/recette-messagerie.js
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';
const results = [];
const check = (label, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'KO '} ${label}${extra ? ' — ' + extra : ''}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function tokenOf(email, pwd) { return (await api('POST', '/api/auth/login', null, { email, password: pwd, tenant_code: 'ECOLEA' })).json.data.token; }

(async () => {
  const PWD = 'Motdepasse-123';
  const admin = await tokenOf('admin@a.test', PWD);
  const prof = await tokenOf('prof@a.test', PWD);
  const me = await api('GET', '/api/auth/me', prof);
  const profId = me.json.data.user ? me.json.data.user.id : me.json.data.id;
  const title = `Recette destinataire ${Date.now()}`;
  const conv = await api('POST', '/api/messages/conversations', admin, { title, type: 'private' });
  check('l’expéditeur crée une conversation', conv.status === 201, `HTTP ${conv.status}`);
  const convId = conv.json.data.id;
  const add = await api('POST', `/api/messages/conversations/${convId}/participants`, admin, { user_id: profId });
  check('l’expéditeur ajoute le destinataire', add.status === 201 || add.status === 200, `HTTP ${add.status}`);
  const sent = await api('POST', '/api/messages/messages', admin, { conversation_id: convId, content: 'Bonjour, merci de confirmer la réunion.' });
  check('message envoyé', sent.status === 201, `HTTP ${sent.status}`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const calls = [];
  page.on('response', (r) => { if (/\/conversations\/[^/]+\/(receive|read)$/.test(new URL(r.url()).pathname)) calls.push(`${new URL(r.url()).pathname.split('/').pop()}:${r.status()}`); });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('input[name=tenant_code]', 'ECOLEA'); await page.fill('input[name=email]', 'prof@a.test'); await page.fill('input[name=password]', PWD);
  await page.click('#login-submit');
  await page.waitForFunction(() => document.querySelector('#login-overlay')?.classList.contains('hidden'), null, { timeout: 15000 });
  await navTo(page, 'messages'); await page.waitForTimeout(800);
  const conversation = page.locator('[data-conv]', { hasText: title }).first();
  check('le destinataire voit la conversation dans sa liste', (await conversation.count()) === 1);
  await conversation.click(); await page.waitForTimeout(1500);
  const thread = (await page.textContent('#thread')) || '';
  check('le message s’affiche dans le fil du destinataire', thread.includes('Bonjour, merci de confirmer'));
  check('le navigateur signale la réception et la lecture', calls.includes('receive:200') && calls.includes('read:200'), calls.join(', ') || 'aucun appel');

  const after = await api('GET', `/api/messages/messages?conversation_id=${convId}`, admin);
  const m = after.json.data.find((x) => x.content.startsWith('Bonjour, merci'));
  check('l’expéditeur voit 1 destinataire lu sur 1', m && m.recipients_count === 1 && m.read_count === 1, m ? `${m.read_count}/${m.recipients_count}` : 'message introuvable');
  check('aucune erreur JavaScript côté destinataire', errors.length === 0, errors.join(' | '));

  const other = await api('GET', `/api/messages/messages?conversation_id=${convId}`, await tokenOf('gerant@a.test', 'Gerant-Pass-2026'));
  check('un utilisateur non participant ne voit aucun message de la conversation', other.status === 200 && Array.isArray(other.json.data) && other.json.data.length === 0, `HTTP ${other.status}`);
  await browser.close();
  const ko = results.filter((x) => !x).length;
  console.log(`\nRésultat : ${results.length - ko}/${results.length} vérifications réussies`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e.message); process.exit(1); });
