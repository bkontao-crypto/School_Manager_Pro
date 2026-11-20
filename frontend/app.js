// SCHOOL MANAGER PRO — interface web (v2.4.0)
// Aucune dépendance externe : tout est servi par l'application (CSP stricte « 'self' »).
// L'établissement est déterminé par le jeton de connexion ; aucune identité n'est stockée en dur.
'use strict';

const $ = (id) => document.getElementById(id);
const fmtNumber = (n) => new Intl.NumberFormat('fr-FR').format(Number(n || 0));
const money = (n) => `${fmtNumber(n)} F`;
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const displayDate = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');
const renderCell = (v, fmt) => (v === null || v === undefined || v === '' ? '—' : escapeHtml(fmt ? fmt(v) : v));
const cell = (v) => escapeHtml(v === null || v === undefined || v === '' ? '—' : v);

// ---------------------------------------------------------------- Session
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } }
};
const session = { token: store.get('smp.token'), tenantId: store.get('smp.tenantId'), user: null };

const ROLE_LABELS = { superadmin: 'Super administrateur', admin: 'Administrateur', gerant: 'Gérant', teacher: 'Enseignant', accountant: 'Comptable', staff: 'Personnel', parent: 'Parent', user: 'Utilisateur' };
// Niveau d'accès au module (none / read / write) pour l'utilisateur connecté ; l'administrateur a tout.
const permOf = (key) => (session.user && ['admin', 'superadmin'].includes(session.user.role) ? 'write' : ((session.user && session.user.permissions) || {})[key] || 'none');
const STATUS_LABELS = {
  active: 'Actif', inactive: 'Inactif', suspended: 'Suspendu', graduated: 'Diplômé', transferred: 'Transféré',
  paye: 'Payé', en_attente: 'En attente', annule: 'Annulé', present: 'Présent', absent: 'Absent', late: 'En retard', justified: 'Justifié',
  saisie: 'Saisie', validee: 'Validée', annulee: 'Annulée', planifie: 'Planifié', servi: 'Servi', actif: 'Actif'
};
const label = (v) => STATUS_LABELS[v] || v;

class ApiError extends Error { constructor(message, status, errors) { super(message); this.status = status; this.errors = errors; } }

function authHeaders() {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  return headers;
}

async function api(method, path, body) {
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new ApiError('Serveur injoignable. Vérifiez votre connexion.', 0); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && ['tenant_suspended', 'license_expired'].includes(data.code) && path !== '/api/auth/login') { endSession(data.error); throw new ApiError(data.error, 403); }
  if (res.status === 401 && path !== '/api/auth/login') { endSession(); throw new ApiError('Session expirée, reconnectez-vous.', 401); }
  if (!res.ok) {
    const detail = Array.isArray(data.errors) && data.errors.length ? ` — ${data.errors.map((e) => e.message || e.field).join(' ; ')}` : '';
    throw new ApiError((data.error || `Erreur HTTP ${res.status}`) + detail, res.status, data.errors);
  }
  return data;
}
const get = (p) => api('GET', p);
const rows = (payload) => (Array.isArray(payload && payload.data) ? payload.data : []);

function toast(message, kind = 'ok') {
  const t = $('toast');
  t.textContent = message;
  t.className = `fixed bottom-5 right-5 z-50 max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 4500);
}

// ---------------------------------------------------------------- Fenêtres modales
let modalResolve = null;
function closeModal(result) {
  $('modal-overlay').classList.add('hidden');
  $('modal-box').innerHTML = '';
  if (modalResolve) { const r = modalResolve; modalResolve = null; r(result); }
}
function openModal(html) {
  $('modal-box').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
  const first = $('modal-box').querySelector('input:not([type=hidden]),select,textarea,button');
  if (first) first.focus();
  return new Promise((resolve) => { modalResolve = resolve; });
}
$('modal-overlay').addEventListener('mousedown', (e) => { if (e.target === $('modal-overlay')) closeModal(null); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal-overlay').classList.contains('hidden')) closeModal(null); });

function confirmDialog(title, message, danger = true) {
  const p = openModal(`<h3 id="modal-title" class="font-bold text-lg text-slate-900">${escapeHtml(title)}</h3><p class="mt-2 text-sm text-slate-600">${escapeHtml(message)}</p>
    <div class="mt-5 flex justify-end gap-2"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Annuler</button>
    <button type="button" data-modal-ok class="px-4 py-2 rounded-lg text-white text-sm font-semibold ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}">Confirmer</button></div>`);
  $('modal-box').querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(false));
  $('modal-box').querySelector('[data-modal-ok]').addEventListener('click', () => closeModal(true));
  return p.then((r) => r === true);
}
function infoDialog(title, message) {
  const p = openModal(`<h3 id="modal-title" class="font-bold text-lg text-slate-900">${escapeHtml(title)}</h3><p class="mt-2 text-sm text-slate-600">${escapeHtml(message)}</p>
    <div class="mt-5 flex justify-end"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Fermer</button></div>`);
  $('modal-box').querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(null));
  return p;
}

// ---------------------------------------------------------------- Formulaires (champs décrits par une configuration)
const INPUT_CLS = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500/30';

function fieldHtml(f, value) {
  const req = f.required ? 'required' : '';
  const v = value === undefined || value === null ? '' : value;
  let control;
  if (f.type === 'select') {
    control = `<select name="${f.name}" ${req} class="${INPUT_CLS}">${f.required ? '' : '<option value="">—</option>'}${f.options.map(([val, text]) => `<option value="${escapeHtml(val)}" ${String(val) === String(v) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select>`;
  } else if (f.type === 'student') {
    control = `<span class="relative block mt-1" data-student-picker>
      <input type="search" data-student-search placeholder="Tapez un nom ou un matricule…" autocomplete="off" class="${INPUT_CLS} mt-0">
      <input type="hidden" name="${f.name}" value="${escapeHtml(v)}" data-student-value>
      <span data-student-results class="hidden absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1 block"></span>
      <span data-student-status class="block mt-1 text-xs font-normal text-slate-500">Saisissez au moins 2 caractères.</span>
    </span>`;
  } else if (f.type === 'class') {
    control = `<select name="${f.name}" ${req} data-class-select data-value="${escapeHtml(v)}" class="${INPUT_CLS}"><option value="">Chargement…</option></select>`;
  } else if (f.type === 'teacher') {
    control = `<select name="${f.name}" data-teacher-select data-value="${escapeHtml(v)}" class="${INPUT_CLS}"><option value="">Chargement…</option></select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea name="${f.name}" rows="3" ${req} class="${INPUT_CLS}">${escapeHtml(v)}</textarea>`;
  } else if (f.type === 'list') {
    control = `<input name="${f.name}" type="text" value="${escapeHtml(Array.isArray(v) ? v.join(', ') : v)}" placeholder="Valeurs séparées par des virgules" class="${INPUT_CLS}">`;
  } else {
    const type = f.type === 'number' ? 'text' : f.type || 'text'; // « text » + inputmode : la virgule décimale est acceptée par l'API
    control = `<input name="${f.name}" type="${type}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${escapeHtml(v)}" ${req} class="${INPUT_CLS}">`;
  }
  return `<label class="block text-xs font-semibold text-slate-600">${escapeHtml(f.label)}${f.required ? ' *' : ''}${control}</label>`;
}

async function hydrateFormWidgets(root) {
  const classSelects = root.querySelectorAll('[data-class-select]');
  if (classSelects.length) {
    try {
      const classes = rows(await get('/api/classes?limit=200'));
      classSelects.forEach((sel) => {
        const cur = sel.dataset.value || '';
        sel.innerHTML = `<option value="">— Aucune —</option>${classes.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)}${c.level ? ` (${escapeHtml(c.level)})` : ''}</option>`).join('')}`;
      });
    } catch (e) { classSelects.forEach((sel) => { sel.innerHTML = '<option value="">Classes indisponibles</option>'; }); }
  }
  const teacherSelects = root.querySelectorAll('[data-teacher-select]');
  if (teacherSelects.length) {
    try {
      const teachers = rows(await get('/api/teachers?limit=200'));
      teacherSelects.forEach((sel) => {
        const cur = sel.dataset.value || '';
        sel.innerHTML = `<option value="">— Non précisé —</option>${teachers.map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === cur ? 'selected' : ''}>${escapeHtml(t.last_name)} ${escapeHtml(t.first_name)}</option>`).join('')}`;
      });
    } catch (e) { teacherSelects.forEach((sel) => { sel.innerHTML = '<option value="">Enseignants indisponibles</option>'; }); }
  }
  root.querySelectorAll('[data-student-picker]').forEach((picker) => {
    const input = picker.querySelector('[data-student-search]');
    const hidden = picker.querySelector('[data-student-value]');
    const box = picker.querySelector('[data-student-results]');
    const status = picker.querySelector('[data-student-status]');
    const setStatus = (text, ok) => { status.textContent = text; status.className = `block mt-1 text-xs font-normal ${ok ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`; };
    let timer; let seq = 0; let found = [];
    const pick = (st) => {
      hidden.value = st.id; input.value = `${st.last_name} ${st.first_name} — ${st.matricule}`;
      box.classList.add('hidden'); setStatus('Élève sélectionné.', true);
    };
    input.addEventListener('input', () => {
      hidden.value = ''; clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { box.classList.add('hidden'); setStatus('Saisissez au moins 2 caractères.', false); return; }
      setStatus('Recherche…', false);
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const list = rows(await get(`/api/students?q=${encodeURIComponent(q)}&limit=8`));
          if (mine !== seq) return;
          found = list;
          box.innerHTML = list.length
            ? list.map((st) => `<button type="button" data-pick="${escapeHtml(st.id)}" class="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none flex items-center justify-between gap-3"><span class="text-slate-800">${escapeHtml(st.last_name)} ${escapeHtml(st.first_name)}</span><span class="text-xs text-slate-500 shrink-0">${escapeHtml(st.matricule)}</span></button>`).join('')
            : '<span class="block px-3 py-2 text-slate-500">Aucun élève trouvé.</span>';
          box.classList.remove('hidden');
          setStatus(list.length ? 'Choisissez un élève dans la liste.' : 'Aucun élève ne correspond à cette recherche.', false);
        } catch (e) { box.classList.add('hidden'); setStatus(e.message, false); }
      }, 250);
    });
    box.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-pick]'); if (!btn) return;
      const st = found.find((x) => x.id === btn.dataset.pick); if (st) pick(st);
    });
  });
}

function collectForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const raw = new FormData(form).get(f.name);
    const value = raw === null ? '' : f.type === 'password' ? String(raw) : String(raw).trim();
    if (value === '') { if (f.clearable) out[f.name] = null; continue; }
    out[f.name] = f.type === 'list' ? value.split(',').map((x) => x.trim()).filter(Boolean) : value; // identifiants et nombres restent des chaînes : l'API valide
  }
  return out;
}

function formModal({ title, fields, values = {}, submit = 'Enregistrer', onSubmit }) {
  const p = openModal(`<h3 id="modal-title" class="font-bold text-lg text-slate-900 mb-4">${escapeHtml(title)}</h3>
    <form id="modal-form" class="space-y-3" novalidate>${fields.map((f) => fieldHtml(f, values[f.name])).join('')}
    <p id="modal-error" class="text-sm text-red-600 min-h-5" role="alert"></p>
    <div class="flex justify-end gap-2"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Annuler</button>
    <button class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">${escapeHtml(submit)}</button></div></form>`);
  const form = $('modal-form');
  hydrateFormWidgets(form);
  form.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(null));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button:not([type=button])');
    const data = collectForm(form, fields);
    const missing = fields.filter((f) => f.required && !(f.name in data)).map((f) => f.label);
    if (missing.length) { $('modal-error').textContent = `Renseignez : ${missing.join(', ')}.`; return; }
    btn.disabled = true;
    try { await onSubmit(data); closeModal(true); }
    catch (e) { $('modal-error').textContent = e.message; btn.disabled = false; }
  });
  return p;
}

// ---------------------------------------------------------------- Connexion / déconnexion
function showLogin(message) {
  $('login-overlay').classList.remove('hidden');
  $('login-error').textContent = message || '';
  const f = $('login-form');
  f.password.value = '';
  (f.email.value ? f.password : f.tenant_code).focus();
}
function endSession(message) {
  session.token = null; session.user = null;
  store.del('smp.token');
  $('login-overlay').classList.remove('hidden');
  $('login-error').textContent = message || 'Session terminée. Veuillez vous reconnecter.';
  lastBannerMeta = null; loadPublicIdentity();
}
$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.currentTarget;
  const body = { email: f.email.value.trim(), password: f.password.value };
  if (f.tenant_code.value.trim()) body.tenant_code = f.tenant_code.value.trim();
  $('login-submit').disabled = true;
  $('login-error').textContent = '';
  try {
    const res = await api('POST', '/api/auth/login', body);
    session.token = res.data.token; session.user = res.data.user;
    store.set('smp.token', session.token);
    f.password.value = '';
    $('login-overlay').classList.add('hidden');
    await startApp();
  } catch (e) { $('login-error').textContent = e.message; }
  finally { $('login-submit').disabled = false; }
});
$('forgot-btn').addEventListener('click', async () => {
  const f = $('login-form');
  const ok = await formModal({ title: 'Mot de passe oublié', submit: 'Envoyer le lien', values: { tenant_code: f.tenant_code.value, email: f.email.value },
    fields: [{ name: 'tenant_code', label: 'Code de l’établissement (vide pour le superadmin)' }, { name: 'email', label: 'Adresse e-mail', type: 'email', required: true }],
    onSubmit: async (v) => { const r = await api('POST', '/api/auth/forgot', v); toast(r.message || 'Demande envoyée.'); } });
  if (ok) $('login-error').textContent = '';
});
async function openResetFromLink() {
  const m = /^#reset=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  const token = m[1];
  history.replaceState(null, '', location.pathname + location.search);
  $('login-overlay').classList.remove('hidden');
  const ok = await formModal({ title: 'Nouveau mot de passe', submit: 'Enregistrer',
    fields: [{ name: 'new_password', label: 'Nouveau mot de passe (8 caractères minimum)', type: 'password', required: true }, { name: 'confirm', label: 'Confirmer le mot de passe', type: 'password', required: true }],
    onSubmit: async (v) => { if (v.new_password !== v.confirm) throw new Error('Les deux mots de passe ne correspondent pas.'); await api('POST', '/api/auth/reset', { token, new_password: v.new_password }); } });
  if (ok) { toast('Mot de passe modifié : connectez-vous.'); showLogin('Mot de passe modifié : vous pouvez vous connecter.'); }
  else showLogin('Lien de réinitialisation abandonné.');
}
$('logout-btn').addEventListener('click', (ev) => {
  ev.preventDefault();
  session.token = null; session.user = null; session.tenantId = null;
  store.del('smp.token'); store.del('smp.tenantId');
  $('main-content').scrollTop = 0;
  showDashboard();
  showLogin('Vous êtes déconnecté.');
});

// ---------------------------------------------------------------- Tableau de bord
const dashboardNodes = () => [...document.querySelectorAll('#main-content > :not(#module-view)')];
const moduleView = $('module-view');
function showDashboard() {
  moduleView.classList.add('hidden');
  dashboardNodes().forEach((n) => n.classList.remove('hidden'));
  setActiveNav('dashboard');
}
function showView() { dashboardNodes().forEach((n) => n.classList.add('hidden')); moduleView.classList.remove('hidden'); }
function setActiveNav(key) {
  document.querySelectorAll('nav [data-module]').forEach((a) => {
    const on = a.dataset.module === key;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-group-wrap]').forEach((wrap) => { if (wrap.querySelector('a.is-active')) setNavGroupOpen(wrap, true); });
}

// Menu à sous-sections : ouverture par groupe, groupe actif ouvert automatiquement, groupes vides masqués.
function setNavGroupOpen(wrap, open) {
  const btn = wrap.querySelector('[data-group]'); const panel = wrap.querySelector('.nav-panel'); const chev = wrap.querySelector('.nav-chevron');
  btn.setAttribute('aria-expanded', String(open)); panel.classList.toggle('hidden', !open); chev.classList.toggle('rotate-90', open);
}
function syncNavGroups() {
  document.querySelectorAll('[data-group-wrap]').forEach((wrap) => {
    const visible = [...wrap.querySelectorAll('[data-module]')].some((a) => !a.classList.contains('hidden'));
    wrap.classList.toggle('hidden', !visible);
  });
}
document.querySelectorAll('[data-group]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const wrap = btn.closest('[data-group-wrap]');
    setNavGroupOpen(wrap, btn.getAttribute('aria-expanded') !== 'true');
  });
});

function barChart(series) {
  const max = Math.max(1, ...series.map((s) => s.total));
  const W = 420, H = 210, base = 170, top = 20, bw = 38, gap = (W - 20 - bw * series.length) / Math.max(1, series.length - 1);
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const bars = series.map((s, i) => {
    const h = Math.round((s.total / max) * (base - top));
    const x = 10 + i * (bw + gap);
    const m = MONTHS[Number(s.month.slice(5, 7)) - 1];
    return `<g><title>${escapeHtml(m)} ${s.month.slice(0, 4)} : ${money(s.total)}</title><rect x="${x}" y="${base - h}" width="${bw}" height="${Math.max(h, s.total ? 2 : 0)}" rx="5" fill="#2563eb"/>
      <text x="${x + bw / 2}" y="${base - h - 6}" text-anchor="middle" font-size="10" fill="#475569">${s.total ? fmtNumber(Math.round(s.total / 1000)) + ' k' : ''}</text>
      <text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle" font-size="11" fill="#64748b">${escapeHtml(m)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-full" role="presentation"><line x1="10" y1="${base}" x2="${W - 10}" y2="${base}" stroke="#e2e8f0"/>${bars}</svg>`;
}

const ACTION_LABELS = {
  'auth.login': 'Connexion', 'banner.update': 'Affiche d’accueil publiée', 'banner.text': 'Textes de l’affiche modifiés', 'banner.reset': 'Affiche par défaut rétablie', 'banner.image.add': 'Image ajoutée à l’affiche', 'banner.image.update': 'Cadrage ou image principale de l’affiche modifiés', 'banner.image.order': 'Ordre des images de l’affiche modifié', 'banner.image.delete': 'Image retirée de l’affiche', 'auth.password_change': 'Mot de passe modifié',
  'student.create': 'Élève ajouté', 'student.update': 'Élève modifié', 'student.delete': 'Élève supprimé',
  'payment.create': 'Paiement enregistré', 'grade.create': 'Note saisie', 'attendance.create': 'Présence enregistrée',
  'class.create': 'Classe créée', 'teacher.create': 'Enseignant ajouté', 'tenant.create': 'Établissement créé', 'tenant.update': 'Établissement modifié',
  'staff.create': 'Membre du personnel ajouté', 'stock_item.create': 'Article de stock ajouté', 'document.create': 'Document ajouté',
  'conversation.create': 'Conversation créée', 'message.create': 'Message envoyé', 'notification.create': 'Notification créée',
  'timetable_slot.create': 'Cours ajouté à l’emploi du temps', 'timetable_slot.delete': 'Cours retiré de l’emploi du temps',
  'academic_period.create': 'Période scolaire créée', 'academic_period.delete': 'Période scolaire supprimée',
  'user.create': 'Utilisateur créé', 'user.update': 'Utilisateur modifié', 'user.password_reset': 'Mot de passe réinitialisé',
  'report.export_payments': 'Export des paiements', 'book.create': 'Livre ajouté', 'menu.create': 'Menu ajouté', 'transport_route.create': 'Circuit de transport ajouté'
};
function activityText(a) {
  return ACTION_LABELS[a.action] || 'Action enregistrée';
}

// ---------------------------------------------------------------- Affiche d'accueil
const HERO_DEFAULT = { title: $('hero-banner-title').innerHTML, subtitle: $('hero-banner-subtitle').textContent.trim(), src: '/assets/img/banner-default.svg' };
let bannerBlobUrl = null;
let heroUrls = []; let heroSlides = []; let heroIdx = 0; let heroTimer = null;
function paintHero(i) {
  if (!heroSlides.length) return;
  heroIdx = (i + heroSlides.length) % heroSlides.length;
  const sl = heroSlides[heroIdx];
  const img = $('hero-banner-img');
  img.src = sl.src;
  img.style.objectPosition = `${sl.fx}% ${sl.fy}%`;
  [...$('hero-dots').children].forEach((d, k) => { d.classList.toggle('bg-white', k === heroIdx); d.classList.toggle('bg-white/50', k !== heroIdx); });
}
function restartHeroTimer() {
  clearInterval(heroTimer); heroTimer = null;
  if (heroSlides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) heroTimer = setInterval(() => paintHero(heroIdx + 1), 6000);
}
$('hero-dots').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slide]'); if (!b) return;
  paintHero(Number(b.dataset.slide)); restartHeroTimer();
});
function applyBannerMeta(m) {
  lastBannerMeta = m;
  const custom = !!(m && m.custom);
  const title = m && m.title; const subtitle = m && m.subtitle;
  const t = $('hero-banner-title'); const sub = $('hero-banner-subtitle');
  if (title) t.textContent = title; else t.innerHTML = HERO_DEFAULT.title;
  sub.textContent = subtitle || HERO_DEFAULT.subtitle;
  // Affiche personnalisée sans texte : l'image s'affiche seule, sans voile ni titre.
  const showTitle = !custom || !!title;
  t.classList.toggle('hidden', !showTitle);
  sub.classList.toggle('hidden', !(showTitle && (subtitle || !custom)));
  $('hero-banner-text').classList.toggle('hidden', !showTitle && !subtitle);
  $('hero-banner-shade').classList.toggle('hidden', !showTitle && !subtitle);
}
async function loadBanner() {
  try {
    const [m, list] = await Promise.all([get('/api/settings/banner').then((r) => r.data), get('/api/settings/banner/images').then((r) => r.data)]);
    applyBannerMeta(m);
    const slides = []; const urls = [];
    const items = [...list.items].sort((x, y) => Number(y.is_primary) - Number(x.is_primary));
    for (const it of items) {
      const r = await fetch(it.url, { headers: authHeaders() });
      if (!r.ok) continue;
      const u = URL.createObjectURL(await r.blob()); urls.push(u);
      slides.push({ src: u, fx: it.focal_x, fy: it.focal_y });
    }
    if (!slides.length && m.custom) { // affiche unique héritée (avant la galerie)
      const r = await fetch('/api/settings/banner/image', { headers: authHeaders() });
      if (r.ok) { const u = URL.createObjectURL(await r.blob()); urls.push(u); slides.push({ src: u, fx: 50, fy: 50 }); }
    }
    if (!slides.length) slides.push({ src: HERO_DEFAULT.src, fx: 100, fy: 50 });
    heroUrls.forEach((u) => URL.revokeObjectURL(u));
    heroUrls = urls; heroSlides = slides;
    $('hero-dots').innerHTML = slides.length > 1 ? slides.map((_, k) => `<button type="button" data-slide="${k}" aria-label="Afficher l’image ${k + 1}" class="w-2.5 h-2.5 rounded-full bg-white/50 hover:bg-white transition"></button>`).join('') : '';
    paintHero(0); restartHeroTimer();
    return m;
  } catch (e) { return null; /* hors ligne : l'affiche par défaut reste affichée */ }
}

// Contrôle côté navigateur (le serveur revérifie tout) : retourne la liste des écarts aux exigences.
function checkImageFile(file, req, label) {
  return new Promise((resolve) => {
    const errors = [];
    const okType = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
    const weight = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.round(n / 1024)} Ko`);
    if (!okType) errors.push('Format non accepté : utilisez une image PNG, JPEG ou WebP.');
    if (file.size > req.maxBytes) errors.push(`Fichier trop lourd (${weight(file.size)}) : maximum ${weight(req.maxBytes)}.`);
    if (!okType) return resolve({ errors, width: 0, height: 0 });
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth; const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (w < req.minWidth || h < req.minHeight) errors.push(`Résolution trop faible (${w}×${h}) : minimum ${req.minWidth}×${req.minHeight} px.`);
      if (w > req.maxWidth || h > req.maxHeight) errors.push(`Résolution trop élevée (${w}×${h}) : maximum ${req.maxWidth}×${req.maxHeight} px.`);
      if (Math.abs(w / h - req.ratio) / req.ratio > req.ratioTolerance) errors.push(`Proportions incorrectes (${w}×${h}) : ${label} doit être au format ${req.ratio === 1 ? '1:1 (carré)' : `${req.ratio}:1`}.`);
      resolve({ errors, width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ errors: [...errors, 'Image illisible ou corrompue.'], width: 0, height: 0 }); };
    img.src = url;
  });
}

function bannerSectionHtml() {
  return `<section id="banner-section" class="bg-white rounded-2xl border border-slate-200 p-5">
    <h3 class="font-bold mb-1">Affiche d’accueil</h3>
    <p class="text-sm text-slate-500 mb-3">Affichée en haut du tableau de bord pour tous les utilisateurs de l’établissement. Sans affiche personnalisée, l’affiche par défaut est utilisée.</p>
    <div class="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/1]"><img id="banner-prev-img" alt="Aperçu de l’affiche" class="w-full h-full object-cover"></div>
    <ul id="banner-reqs" class="mt-3 text-xs text-slate-600 grid sm:grid-cols-2 gap-x-6 gap-y-1 list-disc pl-5"></ul>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input id="banner-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
      <button id="banner-pick" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">Choisir une image…</button>
      <button id="banner-send" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold hidden">Publier cette affiche</button>
      <button id="banner-reset" class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">Revenir à l’affiche par défaut</button>
    </div>
    <div id="banner-errors" class="mt-3 hidden rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3" role="alert"></div>
    <div class="mt-4 grid sm:grid-cols-2 gap-3">
      <label class="text-sm font-medium text-slate-700">Titre (facultatif)<input id="banner-title" maxlength="120" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Bienvenue sur SCHOOL MANAGER PRO !"></label>
      <label class="text-sm font-medium text-slate-700">Sous-titre (facultatif)<input id="banner-subtitle" maxlength="240" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Gérez votre établissement scolaire en toute simplicité."></label>
    </div>
    <button id="banner-text-save" class="mt-3 px-4 py-2 rounded-lg border border-blue-600 text-blue-700 text-sm font-semibold hover:bg-blue-50">Enregistrer les textes</button>
  </section>`;
}

// Affiche d'un établissement, éditée par le superadmin. base = /api/platform/tenants/:id/banner
async function setupBannerSection(base) {
  const prev = $('banner-prev-img');
  let meta = (await get(base)).data;
  const req = meta.requirements;
  let pending = null; let previewUrl = null;
  const showErrors = (list) => { const box = $('banner-errors'); box.classList.toggle('hidden', !list.length); box.innerHTML = list.length ? `<strong>Image refusée :</strong><ul class="list-disc pl-5 mt-1">${list.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''; };
  $('banner-reqs').innerHTML = [
    `Format : ${req.ratio}:1 (ex. 1600×400 px)`, `Tolérance : ±${Math.round(req.ratioTolerance * 100)} % sur les proportions`,
    `Taille minimale : ${req.minWidth}×${req.minHeight} px`, `Taille maximale : ${req.maxWidth}×${req.maxHeight} px`,
    'Types : PNG, JPEG ou WebP', `Poids maximal : ${req.maxBytes / 1048576} Mo`].map((t) => `<li>${t}</li>`).join('');
  const paintPreview = async () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (meta.custom) { const res = await fetch(`${base}/image`, { headers: authHeaders() }); if (res.ok) previewUrl = URL.createObjectURL(await res.blob()); }
    prev.src = previewUrl || HERO_DEFAULT.src;
  };
  const refresh = async () => {
    await paintPreview();
    $('banner-title').value = meta.title || ''; $('banner-subtitle').value = meta.subtitle || '';
    $('banner-reset').classList.toggle('hidden', !meta.custom && !meta.title && !meta.subtitle);
  };
  const reload = async () => { if (!base.includes('/api/platform/tenants/')) await loadBanner(); meta = (await get(base)).data; await refresh(); };
  await refresh();
  $('banner-pick').addEventListener('click', () => $('banner-file').click());
  $('banner-file').addEventListener('change', async () => {
    const file = $('banner-file').files[0];
    pending = null; $('banner-send').classList.add('hidden'); showErrors([]);
    if (!file) return;
    const r = await checkImageFile(file, req, 'l’affiche');
    if (r.errors.length) { showErrors(r.errors); $('banner-file').value = ''; return; }
    pending = file;
    prev.src = URL.createObjectURL(file);
    $('banner-send').classList.remove('hidden');
  });
  $('banner-send').addEventListener('click', async () => {
    if (!pending) return;
    $('banner-send').disabled = true;
    try {
      const res = await fetch(`${base}/image`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': pending.type }, body: pending });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showErrors(Array.isArray(data.errors) && data.errors.length ? data.errors : [data.error || `Erreur HTTP ${res.status}`]); return; }
      pending = null; $('banner-file').value = ''; $('banner-send').classList.add('hidden');
      await reload(); toast('Affiche d’accueil publiée.');
    } catch (e) { showErrors(['Serveur injoignable. Vérifiez votre connexion.']); } finally { $('banner-send').disabled = false; }
  });
  $('banner-text-save').addEventListener('click', async () => {
    try { await api('PUT', `${base}/text`, { title: $('banner-title').value.trim(), subtitle: $('banner-subtitle').value.trim() }); await reload(); toast('Textes enregistrés.'); } catch (e) { toast(e.message, 'err'); }
  });
  $('banner-reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Affiche par défaut', 'L’affiche personnalisée et les textes seront supprimés.'))) return;
    try { await api('DELETE', base); await reload(); showErrors([]); toast('Affiche par défaut rétablie.'); } catch (e) { toast(e.message, 'err'); }
  });
}

// Tendance : valeur calculée par le serveur, sinon « Pas de donnée ». onDark : carte colorée (texte blanc).
function trendPill(v, unit, onDark) {
  const none = onDark ? 'bg-white/20 text-white' : 'text-slate-400';
  if (v === null || v === undefined || Number.isNaN(Number(v))) return `<span class="${none} rounded-full px-2 py-0.5 whitespace-nowrap">Pas de donnée</span>`;
  const n = Number(v);
  const shown = (Math.round(Math.abs(n) * 10) / 10).toString().replace('.', ',');
  const up = n > 0, down = n < 0;
  const cls = onDark ? 'bg-white/20 text-white' : up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-500';
  const sign = up ? '▲ +' : down ? '▼ −' : '= ';
  return `<span class="${cls} ${onDark ? 'rounded-full px-2 py-0.5' : ''} whitespace-nowrap">${sign}${shown}${unit === 'pts' ? ' pts' : ' %'}</span>`;
}

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Courbe des effectifs (cumul mensuel sur 6 mois) — SVG sans bibliothèque.
function lineChart(series) {
  const W = 420, H = 210, padL = 36, padR = 14, padT = 16, padB = 30;
  const max = Math.max(1, ...series.map((s) => s.total));
  const step = (W - padL - padR) / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => ({ x: padL + i * step, y: padT + (H - padT - padB) * (1 - s.total / max), s }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = H - padB;
  const area = `${path} L${pts[pts.length - 1].x.toFixed(1)},${base} L${pts[0].x.toFixed(1)},${base} Z`;
  const grid = [0, 0.5, 1].map((f) => { const y = padT + (H - padT - padB) * (1 - f); return `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/><text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${fmtNumber(Math.round(max * f))}</text>`; }).join('');
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"><title>${escapeHtml(MONTHS_FR[Number(p.s.month.slice(5, 7)) - 1])} ${p.s.month.slice(0, 4)} : ${fmtNumber(p.s.total)} élèves</title></circle>`).join('');
  const labels = pts.map((p) => `<text x="${p.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#64748b">${escapeHtml(MONTHS_FR[Number(p.s.month.slice(5, 7)) - 1])}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-full" role="presentation"><defs><linearGradient id="enrolGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity=".28"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#enrolGrad)"/><path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

const LEVEL_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#64748b', '#ec4899'];
// Anneau de répartition par niveau — SVG à tirets, sans bibliothèque.
function donutChart(rows) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const C = 2 * Math.PI * 60; let offset = 0;
  const arcs = rows.map((r, i) => {
    const len = (r.count / total) * C;
    const arc = `<circle cx="80" cy="80" r="60" fill="none" stroke="${LEVEL_COLORS[i % LEVEL_COLORS.length]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"><title>${escapeHtml(r.level || 'Non renseigné')} : ${r.count}</title></circle>`;
    offset += len; return arc;
  }).join('');
  return `<svg viewBox="0 0 160 160" class="w-full h-full" role="presentation"><circle cx="80" cy="80" r="60" fill="none" stroke="#f1f5f9" stroke-width="22"/>${arcs}<text x="80" y="78" text-anchor="middle" font-size="20" font-weight="700" fill="#0f172a">${fmtNumber(total)}</text><text x="80" y="96" text-anchor="middle" font-size="10" fill="#64748b">élèves</text></svg>`;
}

const RTF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function relTime(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Math.abs(diff) < 60) return 'à l’instant';
  for (const [unit, sec] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(diff) >= sec) return RTF.format(Math.round(diff / sec), unit);
  return 'à l’instant';
}

async function loadDashboard() {
  loadBanner();
  try {
    const d = (await get('/api/stats/dashboard')).data;
    const t = d.trends || {};
    $('metric-students').textContent = fmtNumber(d.students);
    $('metric-teachers').textContent = fmtNumber(d.teachers);
    $('metric-classes').textContent = fmtNumber(d.classes);
    $('metric-payments').textContent = money(d.payments_month.total);
    $('trend-students').innerHTML = trendPill(t.students, '%', true);
    $('trend-teachers').innerHTML = trendPill(t.teachers, '%', true);
    $('trend-classes').innerHTML = trendPill(t.classes, '%', true);
    $('trend-payments').innerHTML = trendPill(t.payments, '%', true);
    $('metric-grades').textContent = fmtNumber(d.grades);
    $('metric-attendance').textContent = d.attendance_rate === null ? '—' : `${String(d.attendance_rate).replace('.', ',')} %`;
    $('trend-attendance').innerHTML = trendPill(t.attendance, 'pts', false);
    const series = d.enrolment_series || [];
    $('enrolment-chart').innerHTML = series.some((s) => s.total > 0) ? lineChart(series)
      : '<p class="h-full flex items-center justify-center text-sm text-slate-400 text-center px-6">Pas de donnée</p>';
    const levels = (d.level_distribution || []).filter((r) => r.count > 0);
    const lt = levels.reduce((a, r) => a + r.count, 0);
    $('level-chart').innerHTML = lt ? donutChart(levels) : '<p class="h-full flex items-center justify-center text-sm text-slate-400 text-center">Pas de donnée</p>';
    $('level-legend').innerHTML = levels.length ? levels.map((r, i) => `<li class="flex items-center justify-between gap-2"><span class="flex items-center gap-2 min-w-0"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${LEVEL_COLORS[i % LEVEL_COLORS.length]}"></span><span class="truncate text-slate-700">${escapeHtml(r.level || 'Non renseigné')}</span></span><span class="font-semibold text-ink whitespace-nowrap">${fmtNumber(r.count)} <span class="font-normal text-slate-400">· ${Math.round((r.count / lt) * 100)} %</span></span></li>`).join('')
      : '<li class="text-slate-400">Pas de donnée</li>';
    $('payments-chart').innerHTML = d.payments_series.some((s) => s.total > 0) ? barChart(d.payments_series)
      : '<p class="h-full flex items-center justify-center text-sm text-slate-400 text-center px-6">Aucun encaissement sur les 6 derniers mois.</p>';
    const body = $('recent-payments');
    body.innerHTML = d.recent_payments.length ? d.recent_payments.map((p, i) => `<tr><td class="py-2.5 text-slate-400">${i + 1}</td><td class="py-2.5">${escapeHtml(p.student_name)}</td><td class="py-2.5">${money(p.amount)}</td><td class="py-2.5 text-slate-500">${displayDate(p.paid_at)}</td><td class="py-2.5 text-right"><span class="px-2.5 py-0.5 rounded-full ${p.status === 'paye' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${escapeHtml(label(p.status))}</span></td></tr>`).join('')
      : '<tr><td colspan="5" class="py-6 text-center text-slate-400">Aucun paiement enregistré.</td></tr>';
    $('recent-activities').innerHTML = d.recent_activity.length
      ? d.recent_activity.map((a) => `<div class="flex items-start gap-3 border-b border-slate-100 pb-2.5 last:border-0"><span class="mt-0.5 w-7 h-7 rounded-lg bg-blue-50 text-royal-600 flex items-center justify-center text-xs shrink-0"><i class="fa-solid fa-circle-check"></i></span><div class="min-w-0"><p class="text-ink font-medium truncate">${escapeHtml(activityText(a))}</p><p class="text-xs text-slate-400">${escapeHtml(a.user_name || 'Système')} · ${relTime(a.created_at)}</p></div></div>`).join('')
      : '<p>Aucune activité enregistrée pour le moment.</p>';
  } catch (e) {
    ['metric-students', 'metric-teachers', 'metric-classes', 'metric-grades', 'metric-attendance', 'metric-payments'].forEach((id) => { $(id).textContent = 'N/D'; });
    $('payments-chart').innerHTML = `<p class="h-full flex items-center justify-center text-sm text-red-500 text-center px-6">${escapeHtml(e.message)}</p>`;
    $('recent-payments').innerHTML = '<tr><td colspan="5" class="py-6 text-center text-red-500">Impossible de charger les paiements.</td></tr>';
    $('recent-activities').innerHTML = '<p class="text-red-500">Impossible de charger les activités.</p>';
  }
}

// ---------------------------------------------------------------- Gestionnaire de l'affiche (établissement, paramètres)
function bannerManagerHtml() {
  return `<section id="banner-section" class="${CARD}">
    <h3 class="font-bold mb-1">Affiche d’accueil</h3>
    <p class="text-sm text-slate-500 mb-3">Jusqu’à 6 images, affichées en diaporama sur le tableau de bord. L’image principale s’affiche en premier. Cliquez sur une image pour choisir le point à garder visible.</p>
    <ul id="bm-reqs" class="mb-4 text-xs text-slate-600 grid sm:grid-cols-2 gap-x-6 gap-y-1 list-disc pl-5"></ul>
    <div id="bm-grid" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"></div>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <input id="bm-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
      <button id="bm-add" type="button" class="px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-500 text-white text-sm font-semibold disabled:opacity-50"><i class="fa-solid fa-plus mr-1"></i>Ajouter une image…</button>
      <span id="bm-count" class="text-xs text-slate-500"></span>
    </div>
    <div id="bm-errors" class="mt-3 hidden rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3" role="alert"></div>
    <div class="mt-4 grid sm:grid-cols-2 gap-3">
      <label class="text-sm font-medium text-slate-700">Titre (facultatif)<input id="bm-title" maxlength="120" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Bienvenue sur SCHOOL MANAGER PRO !"></label>
      <label class="text-sm font-medium text-slate-700">Sous-titre (facultatif)<input id="bm-subtitle" maxlength="240" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Gérez votre établissement scolaire en toute simplicité."></label>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button id="bm-text-save" type="button" class="px-4 py-2 rounded-lg border border-royal-600 text-royal-600 text-sm font-semibold hover:bg-blue-50">Enregistrer les textes</button>
      <button id="bm-clear" type="button" class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">Supprimer toutes les images</button>
    </div>
  </section>`;
}

async function setupBannerManager() {
  let items = []; let max = 6; let req = null; let blobs = {};
  const showErrors = (list) => { const box = $('bm-errors'); box.classList.toggle('hidden', !list.length); box.innerHTML = list.length ? `<strong>Action refusée :</strong><ul class="list-disc pl-5 mt-1">${list.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''; };
  const revoke = () => { Object.values(blobs).forEach((u) => URL.revokeObjectURL(u)); blobs = {}; };
  const tile = (it, i) => {
    const fx = Math.min(100, Math.max(0, it.focal_x)); const fy = Math.min(100, Math.max(0, it.focal_y));
    return `<article class="rounded-xl border ${it.is_primary ? 'border-royal-600 ring-2 ring-royal-600/20' : 'border-slate-200'} bg-white overflow-hidden">
      <button type="button" data-bm="focal" data-id="${it.id}" class="relative block w-full aspect-[4/1] bg-slate-100" title="Cliquer pour choisir le point visible">
        <img src="${blobs[it.id] || ''}" alt="Image ${i + 1}" class="w-full h-full object-cover pointer-events-none" style="object-position:${fx}% ${fy}%">
        <span class="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-royal-600 shadow pointer-events-none" style="left:${fx}%;top:${fy}%"></span>
      </button>
      <div class="flex items-center justify-between gap-2 p-2.5 text-xs">
        <span class="font-semibold ${it.is_primary ? 'text-royal-600' : 'text-slate-600'}">${it.is_primary ? '<i class="fa-solid fa-star"></i> Principale' : `Image ${i + 1}`}</span>
        <div class="flex items-center gap-1">
          <button type="button" data-bm="up" data-id="${it.id}" aria-label="Monter" ${i === 0 ? 'disabled' : ''} class="w-7 h-7 rounded-md hover:bg-slate-100 disabled:opacity-30"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" data-bm="down" data-id="${it.id}" aria-label="Descendre" ${i === items.length - 1 ? 'disabled' : ''} class="w-7 h-7 rounded-md hover:bg-slate-100 disabled:opacity-30"><i class="fa-solid fa-arrow-down"></i></button>
          ${it.is_primary ? '' : `<button type="button" data-bm="primary" data-id="${it.id}" aria-label="Définir comme principale" class="w-7 h-7 rounded-md hover:bg-slate-100 text-amber-500"><i class="fa-regular fa-star"></i></button>`}
          <button type="button" data-bm="delete" data-id="${it.id}" aria-label="Supprimer cette image" class="w-7 h-7 rounded-md hover:bg-red-50 text-red-600"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </div>
    </article>`;
  };
  const render = () => {
    $('bm-count').textContent = `${items.length} / ${max} image${items.length > 1 ? 's' : ''}`;
    $('bm-add').disabled = items.length >= max;
    $('bm-grid').innerHTML = items.length ? items.map(tile).join('')
      : '<p class="sm:col-span-2 xl:col-span-3 text-sm text-slate-400 py-8 text-center border border-dashed border-slate-300 rounded-xl">Aucune image : l’affiche par défaut est utilisée.</p>';
  };
  const refresh = async () => {
    const data = (await get('/api/settings/banner/images')).data;
    items = data.items; max = data.max; req = data.requirements;
    const meta = (await get('/api/settings/banner')).data;
    if (document.activeElement !== $('bm-title')) $('bm-title').value = meta.title || '';
    if (document.activeElement !== $('bm-subtitle')) $('bm-subtitle').value = meta.subtitle || '';
    $('bm-reqs').innerHTML = [
      `Format : ${req.ratio}:1 (ex. 1600×400 px)`, `Tolérance : ±${Math.round(req.ratioTolerance * 100)} % sur les proportions`,
      `Taille minimale : ${req.minWidth}×${req.minHeight} px`, `Taille maximale : ${req.maxWidth}×${req.maxHeight} px`,
      'Types : PNG, JPEG ou WebP', `Poids maximal : ${req.maxBytes / 1048576} Mo`].map((t) => `<li>${t}</li>`).join('');
    revoke();
    await Promise.all(items.map(async (it) => { const r = await fetch(it.url, { headers: authHeaders() }); if (r.ok) blobs[it.id] = URL.createObjectURL(await r.blob()); }));
    render();
  };
  const afterChange = () => { loadBanner(); };

  $('bm-add').addEventListener('click', () => $('bm-file').click());
  $('bm-file').addEventListener('change', async () => {
    const file = $('bm-file').files[0];
    showErrors([]);
    if (!file) return;
    if (items.length >= max) { showErrors([`Limite atteinte : ${max} images maximum par établissement.`]); $('bm-file').value = ''; return; }
    const r = await checkImageFile(file, req, 'l’image');
    if (r.errors.length) { showErrors(r.errors); $('bm-file').value = ''; return; }
    try {
      const res = await fetch('/api/settings/banner/images', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': file.type }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showErrors(Array.isArray(data.errors) && data.errors.length ? data.errors : [data.error || `Erreur HTTP ${res.status}`]); return; }
      await refresh(); afterChange(); toast('Image ajoutée à l’affiche.');
    } catch (e) { showErrors(['Serveur injoignable. Vérifiez votre connexion.']); }
    finally { $('bm-file').value = ''; }
  });

  $('bm-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-bm]'); if (!btn || btn.disabled) return;
    const id = btn.dataset.id; const idx = items.findIndex((i) => i.id === id); const act = btn.dataset.bm;
    showErrors([]);
    try {
      if (act === 'focal') {
        const rc = btn.getBoundingClientRect();
        const clamp = (v) => Math.min(100, Math.max(0, Math.round(v * 100) / 100));
        await api('PUT', `/api/settings/banner/images/${id}`, { focal_x: clamp(((e.clientX - rc.left) / rc.width) * 100), focal_y: clamp(((e.clientY - rc.top) / rc.height) * 100) });
      } else if (act === 'primary') {
        await api('PUT', `/api/settings/banner/images/${id}`, { is_primary: true });
      } else if (act === 'up' || act === 'down') {
        const j = act === 'up' ? idx - 1 : idx + 1;
        const ids = items.map((i) => i.id); [ids[idx], ids[j]] = [ids[j], ids[idx]];
        await api('PUT', '/api/settings/banner/images/order', { ids });
      } else if (act === 'delete') {
        if (!(await confirmDialog('Supprimer cette image', 'Elle ne sera plus affichée sur le tableau de bord.'))) return;
        await api('DELETE', `/api/settings/banner/images/${id}`);
      }
      await refresh(); afterChange();
    } catch (err) { showErrors([err.message]); }
  });

  $('bm-text-save').addEventListener('click', async () => {
    try { await api('PUT', '/api/settings/banner/text', { title: $('bm-title').value.trim(), subtitle: $('bm-subtitle').value.trim() }); afterChange(); toast('Textes enregistrés.'); }
    catch (e) { toast(e.message, 'err'); }
  });

  $('bm-clear').addEventListener('click', async () => {
    if (!items.length) { showErrors(['Aucune image à supprimer.']); return; }
    if (!(await confirmDialog('Supprimer toutes les images', `Les ${items.length} images de l’affiche seront supprimées. L’affiche par défaut sera utilisée.`))) return;
    try {
      for (const it of items) await api('DELETE', `/api/settings/banner/images/${it.id}`);
      await refresh(); afterChange(); toast('Affiche par défaut rétablie.');
    } catch (e) { showErrors([e.message]); await refresh(); afterChange(); }
  });

  await refresh();
}

async function loadHealth() {
  const dot = $('status-dot'), txt = $('api-status');
  try {
    const h = await (await fetch('/api/health')).json();
    $('app-version').textContent = `Version ${h.version}`;
    dot.className = `w-2 h-2 rounded-full ${h.database ? 'bg-emerald-500' : 'bg-amber-500'}`;
    txt.textContent = h.database ? 'En ligne' : 'Base de données indisponible';
  } catch (e) { dot.className = 'w-2 h-2 rounded-full bg-red-500'; txt.textContent = 'Hors ligne'; }
}

// ---------------------------------------------------------------- Modules
const ADMIN = ['admin'];
const STUDENT_FIELDS = [
  { name: 'matricule', label: 'Matricule', required: true }, { name: 'first_name', label: 'Prénom', required: true }, { name: 'last_name', label: 'Nom', required: true },
  { name: 'date_of_birth', label: 'Date de naissance', type: 'date', clearable: true },
  { name: 'gender', label: 'Sexe', type: 'select', options: [['M', 'Masculin'], ['F', 'Féminin']], clearable: true },
  { name: 'class_id', label: 'Classe', type: 'class', clearable: true }
];
const MODULES = {
  students: { title: 'Élèves', endpoint: '/api/students', writeRoles: ADMIN, search: true, fields: STUDENT_FIELDS,
    columns: [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['class_name', 'Classe'], ['status', 'Statut', label]] },
  teachers: { title: 'Enseignants', endpoint: '/api/teachers', writeRoles: ADMIN,
    fields: [{ name: 'first_name', label: 'Prénom', required: true }, { name: 'last_name', label: 'Nom', required: true }, { name: 'matricule', label: 'Matricule' }, { name: 'email', label: 'E-mail', type: 'email' }, { name: 'specialties', label: 'Spécialités', type: 'list' }],
    columns: [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['email', 'E-mail'], ['specialties', 'Spécialités', (v) => (v || []).join(', ')], ['status', 'Statut', label]] },
  classes: { title: 'Classes', endpoint: '/api/classes', writeRoles: ADMIN,
    fields: [{ name: 'name', label: 'Nom de la classe', required: true }, { name: 'level', label: 'Niveau' }, { name: 'school_year', label: 'Année scolaire (ex. 2026-2027)' }, { name: 'max_students', label: 'Effectif maximum', type: 'number' }],
    columns: [['name', 'Classe'], ['level', 'Niveau'], ['school_year', 'Année scolaire'], ['max_students', 'Effectif max.']] },
  grades: { title: 'Notes', endpoint: '/api/grades', writeRoles: ['admin', 'teacher'],
    fields: [{ name: 'student_id', label: 'Élève', type: 'student', required: true }, { name: 'subject', label: 'Matière', required: true }, { name: 'score', label: 'Note', type: 'number', required: true }, { name: 'evaluation_type', label: 'Type d’évaluation (devoir, composition…)' }, { name: 'coefficient', label: 'Coefficient', type: 'number' }],
    columns: [['student_name', 'Élève'], ['subject', 'Matière'], ['evaluation_type', 'Évaluation'], ['score', 'Note'], ['status', 'Statut', label]] },
  attendances: { title: 'Présences', endpoint: '/api/attendances', writeRoles: ['admin', 'teacher'],
    fields: [{ name: 'student_id', label: 'Élève', type: 'student', required: true }, { name: 'class_id', label: 'Classe', type: 'class', clearable: true }, { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'status', label: 'Statut', type: 'select', required: true, options: [['present', 'Présent'], ['absent', 'Absent'], ['late', 'En retard'], ['justified', 'Justifié']] }, { name: 'notes', label: 'Observation' }],
    columns: [['student_name', 'Élève'], ['date', 'Date', displayDate], ['status', 'Statut', label], ['notes', 'Observation']] },
  payments: { title: 'Paiements', endpoint: '/api/payments', writeRoles: ['admin', 'accountant'],
    fields: [{ name: 'student_id', label: 'Élève', type: 'student', required: true }, { name: 'amount', label: 'Montant (F CFA)', type: 'number', required: true }, { name: 'fee_type', label: 'Type de frais (scolarité, inscription…)' }, { name: 'method', label: 'Mode de paiement (espèces, Orange Money…)' },
      { name: 'status', label: 'Statut', type: 'select', options: [['paye', 'Payé'], ['en_attente', 'En attente']] }],
    columns: [['receipt_number', 'Reçu'], ['student_name', 'Élève'], ['amount', 'Montant', money], ['fee_type', 'Frais'], ['method', 'Mode'], ['status', 'Statut', label], ['paid_at', 'Date', displayDate]] },
  library: { title: 'Bibliothèque', endpoint: '/api/library', writeRoles: ADMIN,
    fields: [{ name: 'title', label: 'Titre', required: true }, { name: 'author', label: 'Auteur' }, { name: 'isbn', label: 'ISBN' }],
    columns: [['title', 'Titre'], ['author', 'Auteur'], ['isbn', 'ISBN'], ['available', 'Disponible', (v) => (v ? 'Oui' : 'Non')]] },
  canteen: { title: 'Cantine', endpoint: '/api/canteen', writeRoles: ADMIN,
    fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'items', label: 'Plats', type: 'list' }],
    columns: [['date', 'Date', displayDate], ['items', 'Menu', (v) => (v || []).join(', ')], ['status', 'Statut', label]] },
  transport: { title: 'Transport', endpoint: '/api/transport', writeRoles: ADMIN,
    fields: [{ name: 'name', label: 'Circuit', required: true }, { name: 'vehicle', label: 'Véhicule' }, { name: 'capacity', label: 'Capacité', type: 'number' }],
    columns: [['name', 'Circuit'], ['vehicle', 'Véhicule'], ['capacity', 'Capacité'], ['status', 'Statut', label]] },
  notifications: { title: 'Notifications', endpoint: '/api/notifications', writeRoles: ADMIN,
    fields: [{ name: 'title', label: 'Titre', required: true }, { name: 'message', label: 'Message', type: 'textarea' }, { name: 'recipient', label: 'Destinataire' }],
    columns: [['title', 'Titre'], ['message', 'Message'], ['channel', 'Canal'], ['status', 'Statut'], ['created_at', 'Date', displayDate]] },
  hr: { title: 'Personnel (RH)', endpoint: '/api/hr', writeRoles: ADMIN,
    fields: [{ name: 'first_name', label: 'Prénom', required: true }, { name: 'last_name', label: 'Nom', required: true }, { name: 'position', label: 'Fonction' }, { name: 'department', label: 'Service' },
      { name: 'hire_date', label: 'Date d’embauche', type: 'date' }, { name: 'status', label: 'Statut', type: 'select', options: [['actif', 'Actif'], ['inactif', 'Inactif']] }],
    columns: [['last_name', 'Nom'], ['first_name', 'Prénom'], ['position', 'Fonction'], ['department', 'Service'], ['hire_date', 'Embauche', displayDate], ['status', 'Statut', label]] },
  documents: { title: 'Documents', endpoint: '/api/documents', writeRoles: ['admin', 'teacher'],
    fields: [{ name: 'title', label: 'Titre', required: true }, { name: 'type', label: 'Type (cours, circulaire, bulletin…)' }, { name: 'class_id', label: 'Classe concernée', type: 'class', clearable: true },
      { name: 'status', label: 'Statut', type: 'select', options: [['brouillon', 'Brouillon'], ['publie', 'Publié'], ['archive', 'Archivé']] }],
    columns: [['title', 'Titre'], ['type', 'Type'], ['original_name', 'Fichier', (v) => v || 'Aucun fichier joint'], ['status', 'Statut', (v) => ({ brouillon: 'Brouillon', publie: 'Publié', archive: 'Archivé' }[v] || v)], ['created_at', 'Création', displayDate]] },
  stocks: { title: 'Stocks', endpoint: '/api/stocks', writeRoles: ADMIN,
    fields: [{ name: 'name', label: 'Article', required: true }, { name: 'category', label: 'Catégorie' }, { name: 'quantity', label: 'Quantité', type: 'number' }, { name: 'unit', label: 'Unité (boîte, ramette…)' }, { name: 'threshold', label: 'Seuil d’alerte', type: 'number' }],
    columns: [['name', 'Article'], ['category', 'Catégorie'], ['quantity', 'Quantité', fmtNumber], ['unit', 'Unité'], ['threshold', 'Seuil', fmtNumber], ['status', 'Statut', label]] },
  messages: { title: 'Conversations', endpoint: '/api/messages/conversations', writeRoles: null,
    fields: [{ name: 'title', label: 'Titre de la conversation', required: true }, { name: 'type', label: 'Type', type: 'select', options: [['group', 'Groupe'], ['private', 'Privée']] }],
    columns: [['title', 'Titre'], ['type', 'Type', (v) => (v === 'group' ? 'Groupe' : 'Privée')], ['created_at', 'Création', displayDate]] }
};
const canWrite = (key) => permOf(key) === 'write';

const PAGE = 20;
const listState = { key: null, offset: 0, q: '' };

// Barème de l'établissement (10 ou 20), chargé à l'ouverture du module notes.
let gradeScaleMax = 20;

async function openModule(key, opts = {}) {
  const cfg = MODULES[key];
  setActiveNav(key);
  showView();
  if (key.startsWith('platform-')) return session.user && session.user.role === 'superadmin' ? openPlatform(key, opts) : undefined;
  if (key === 'portal') return session.user && session.user.role === 'parent' ? openPortal() : undefined;
  if (key === 'broadcasts') return openBroadcasts(opts);
  if (key === 'messages') return openMessages(opts);
  if (key === 'timetable') return openTimetable(opts);
  if (key === 'reports') return openReports();
  if (key === 'settings') return openSettings();
  if (!cfg) { moduleView.innerHTML = '<p class="p-6 text-slate-500">Section inconnue.</p>'; return; }
  const EXPORTABLE = { students: 'eleves.csv', grades: 'notes.csv', payments: 'paiements.csv' };
  if (listState.key !== key) { listState.key = key; listState.offset = 0; listState.q = ''; }
  const writable = canWrite(key);
  if (key === 'grades') {
    try { gradeScaleMax = (await get('/api/settings/grading')).data.grade_scale_max; } catch (e) { gradeScaleMax = 20; }
    const scoreField = cfg.fields.find((f) => f.name === 'score');
    if (scoreField) scoreField.label = `Note (sur ${gradeScaleMax})`;
  }
  moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-slate-500">Gestion scolaire</p><h2 class="text-2xl font-bold text-ink">${cfg.title}</h2></div>
    <div class="flex flex-wrap gap-2">${cfg.search ? '<input id="module-q" type="search" placeholder="Nom ou matricule…" class="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Filtrer la liste">' : ''}
    <button id="module-refresh" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold"><i class="fa-solid fa-rotate mr-2"></i>Actualiser</button>
    ${cfg.endpoint && EXPORTABLE[key] ? '<button id="module-export" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold"><i class="fa-solid fa-file-excel mr-2"></i>Exporter</button>' : ''}
    ${writable ? '<button id="module-add" class="px-4 py-2 rounded-xl bg-royal-600 hover:bg-royal-500 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Ajouter</button>' : ''}</div></div>
    <section class="panel p-5"><div class="flex justify-between items-center mb-4"><h3 class="font-bold text-ink">Liste</h3><span id="module-count" class="text-xs text-slate-500">Chargement…</span></div>
    <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border-y border-slate-200">${cfg.columns.map((c) => `<th class="py-3 px-3 first:pl-4">${c[1]}</th>`).join('')}${key === 'students' && writable ? '<th class="py-3 pr-2">Actions</th>' : key === 'students' ? '<th class="py-3 pr-2">Dossier</th>' : key === 'payments' ? '<th class="py-3 pr-2">PDF</th>' : key === 'documents' ? '<th class="py-3 pr-2">Action</th>' : key === 'grades' ? '<th class="py-3 pr-2">Actions</th>' : ''}</tr></thead>
    <tbody id="module-rows"></tbody></table></div>
    <div class="flex items-center justify-between mt-4"><button id="page-prev" class="text-sm text-blue-600 disabled:text-slate-300">← Précédent</button><span id="page-info" class="text-xs text-slate-500"></span><button id="page-next" class="text-sm text-blue-600 disabled:text-slate-300">Suivant →</button></div>
    <p id="module-error" class="text-sm text-red-600 mt-3" role="alert"></p></section>`;
  const colSpan = cfg.columns.length + (key === 'students' || key === 'payments' || key === 'grades' || key === 'documents' ? 1 : 0);

  async function refresh() {
    const tbody = $('module-rows'), count = $('module-count'), err = $('module-error');
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-slate-400">Chargement…</td></tr>`; err.textContent = '';
    const join = cfg.endpoint.includes('?') ? '&' : '?';
    try {
      const res = await get(`${cfg.endpoint}${join}limit=${PAGE}&offset=${listState.offset}${listState.q ? `&q=${encodeURIComponent(listState.q)}` : ''}`);
      const data = rows(res), total = res.meta ? res.meta.total : data.length;
      count.textContent = `${fmtNumber(total)} enregistrement(s)`;
      $('page-info').textContent = total ? `${listState.offset + 1}–${listState.offset + data.length} sur ${fmtNumber(total)}` : '';
      $('page-prev').disabled = listState.offset === 0;
      $('page-next').disabled = listState.offset + data.length >= total;
      const myPending = key === 'grades' ? Object.fromEntries(rows(await get('/api/grades/corrections/mine')).map((c) => [c.grade_id, c.id])) : {};
      tbody.innerHTML = data.length ? data.map((item) => `<tr class="border-b border-slate-100 hover:bg-slate-50/70">${cfg.columns.map(([k, , fmt]) => `<td class="py-3 px-3 first:pl-4 text-slate-700 whitespace-nowrap">${renderCell(item[k], fmt)}</td>`).join('')}${key === 'students'
        ? `<td class="py-3 pr-2 whitespace-nowrap"><button type="button" data-act="profile" data-id="${escapeHtml(item.id)}" class="text-emerald-700 hover:underline mr-3">Dossier</button>${writable ? `<button type="button" data-act="edit" data-id="${escapeHtml(item.id)}" class="text-blue-600 hover:underline mr-3">Modifier</button><button type="button" data-act="delete" data-id="${escapeHtml(item.id)}" class="text-red-600 hover:underline">Supprimer</button>` : ''}</td>` : key === 'payments' ? `<td class="py-3 pr-2">${item.status === 'paye' ? `<button type="button" data-act="receipt" data-id="${escapeHtml(item.id)}" class="text-blue-600 hover:underline"><i class="fa-solid fa-file-pdf mr-1"></i>Reçu</button>` : ''}</td>` : key === 'documents' ? `<td class="py-3 pr-2 whitespace-nowrap">${item.original_name ? `<button type="button" data-act="download" data-id="${escapeHtml(item.id)}" class="text-blue-600 hover:underline mr-3">Télécharger</button>` : ''}${writable && !item.original_name ? `<button type="button" data-act="upload" data-id="${escapeHtml(item.id)}" class="text-emerald-700 hover:underline">Joindre un fichier</button>` : ''}</td>` : key === 'grades' ? `<td class="py-3 pr-2 whitespace-nowrap">${item.status === 'saisie' && session.user.role === 'admin' ? `<button type="button" data-act="validate" data-id="${escapeHtml(item.id)}" class="text-emerald-700 hover:underline mr-3">Valider</button><button type="button" data-act="cancel" data-id="${escapeHtml(item.id)}" class="text-red-600 hover:underline">Annuler</button>` : ''}${item.status === 'validee' && writable ? (myPending[item.id] ? `<button type="button" data-act="withdraw" data-id="${escapeHtml(item.id)}" data-cid="${escapeHtml(myPending[item.id])}" class="text-slate-600 hover:underline">Retirer ma demande</button>` : `<button type="button" data-act="correct" data-id="${escapeHtml(item.id)}" class="text-blue-600 hover:underline">Corriger</button>`) : ''}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${colSpan}" class="py-8 text-center text-slate-400">Aucun enregistrement.</td></tr>`;
      if (key === 'payments') {
        tbody.onclick = async (ev) => {
          const btn = ev.target.closest('button[data-act=receipt]'); if (!btn) return;
          const item = data.find((x) => x.id === btn.dataset.id); if (!item) return;
          try { await downloadFile(`/api/payments/${encodeURIComponent(item.id)}/receipt.pdf`, `recu-${item.receipt_number || 'paiement'}.pdf`); } catch (e) { toast(e.message, 'err'); }
        };
      }
      if (key === 'documents') {
        tbody.onclick = async (ev) => {
          const btn = ev.target.closest('button[data-act]'); if (!btn) return;
          const item = data.find((x) => x.id === btn.dataset.id); if (!item) return;
          if (btn.dataset.act === 'download') {
            try { await downloadFile(`/api/documents/${encodeURIComponent(item.id)}/file`, item.original_name || 'document'); } catch (e) { toast(e.message, 'err'); }
            return;
          }
          const input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf,.png,.jpg,.jpeg';
          input.onchange = async () => {
            const f = input.files[0]; if (!f) return;
            const fd = new FormData(); fd.append('file', f);
            try {
              const res = await fetch(`/api/documents/${encodeURIComponent(item.id)}/file`, { method: 'POST', headers: authHeaders(), body: fd });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`);
              toast('Fichier joint.'); refresh();
            } catch (e) { toast(e.message, 'err'); }
          };
          input.click();
        };
      }
      if (key === 'grades') {
        tbody.onclick = async (ev) => {
          const btn = ev.target.closest('button[data-act]'); if (!btn) return;
          const item = data.find((x) => x.id === btn.dataset.id); if (!item) return;
          try {
            if (btn.dataset.act === 'withdraw') {
              const done = await formModal({ title: 'Retirer ma demande de correction', fields: [{ name: 'reason', label: 'Motif (obligatoire)', required: true }], submit: 'Retirer', onSubmit: (v) => api('POST', `/api/grades/corrections/${encodeURIComponent(btn.dataset.cid)}/withdraw`, v) });
              if (done) { toast('Demande retirée.'); refresh(); }
              return;
            }
            if (btn.dataset.act === 'correct') {
              const sent = await formModal({ title: 'Demande de correction', fields: [{ name: 'score', label: `Nouvelle note (sur ${gradeScaleMax})`, type: 'number', required: true }, { name: 'reason', label: 'Motif (obligatoire)', required: true }], submit: 'Envoyer la demande', onSubmit: (v) => api('POST', `/api/grades/${encodeURIComponent(item.id)}/corrections`, v) });
              if (sent) { toast('Demande envoyée à l’administrateur.'); refresh(); }
              return;
            }
            if (btn.dataset.act === 'cancel') {
              if (!await confirmDialog('Annuler la note', 'La note ne comptera plus dans les bulletins.')) return;
              await api('POST', `/api/grades/${encodeURIComponent(item.id)}/cancel`);
            } else {
              await api('POST', `/api/grades/${encodeURIComponent(item.id)}/validate`);
            }
            toast('Note mise à jour.'); refresh();
          } catch (e) { toast(e.message, 'err'); }
        };
      }
      if (key === 'students') {
        tbody.onclick = async (ev) => {
          const btn = ev.target.closest('button[data-act]'); if (!btn) return;
          const item = data.find((x) => x.id === btn.dataset.id); if (!item) return;
          if (btn.dataset.act === 'profile') return openStudentProfile(item.id);
          if (btn.dataset.act === 'edit') {
            const ok = await formModal({ title: 'Modifier l’élève', fields: STUDENT_FIELDS, values: item, onSubmit: (v) => api('PUT', `/api/students/${encodeURIComponent(item.id)}`, v) });
            if (ok) { toast('Élève modifié.'); refresh(); }
          } else if (btn.dataset.act === 'delete') {
            if (await confirmDialog('Supprimer l’élève', `Retirer ${item.first_name} ${item.last_name} de la liste ? Son historique (notes, paiements) est conservé.`)) {
              try { await api('DELETE', `/api/students/${encodeURIComponent(item.id)}`); toast('Élève supprimé.'); refresh(); } catch (e) { toast(e.message, 'err'); }
            }
          }
        };
      }
    } catch (e) { count.textContent = 'Indisponible'; $('page-info').textContent = ''; tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-red-500">Impossible de charger les données.</td></tr>`; err.textContent = e.message; }
  }
  async function add() {
    const ok = await formModal({ title: `Ajouter — ${cfg.title.toLowerCase()}`, fields: cfg.fields, onSubmit: (v) => api('POST', cfg.endpoint, v) });
    if (ok) { toast('Enregistrement effectué.'); listState.offset = 0; refresh(); }
  }
  $('module-refresh').addEventListener('click', refresh);
  if ($('module-export')) $('module-export').addEventListener('click', async () => {
    const q = new URLSearchParams(); if (key === 'students' && listState.q) q.set('q', listState.q);
    try { await downloadFile(`${cfg.endpoint}/export.csv?${q}`, EXPORTABLE[key]); toast('Export téléchargé (ouvrable dans Excel).'); } catch (e) { toast(e.message, 'err'); }
  });
  $('page-prev').addEventListener('click', () => { listState.offset = Math.max(0, listState.offset - PAGE); refresh(); });
  $('page-next').addEventListener('click', () => { listState.offset += PAGE; refresh(); });
  if (writable) $('module-add').addEventListener('click', add);
  if (cfg.search) {
    const q = $('module-q'); q.value = listState.q; let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { listState.q = q.value.trim(); listState.offset = 0; refresh(); }, 300); });
  }
  await refresh();
  if (opts.add && writable) add();
}

// ---------------------------------------------------------------- Fil de messages
const msgState = { conversationId: null };
async function openMessages(opts = {}) {
  moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-slate-500">Communication interne</p><h2 class="text-2xl font-bold text-slate-900">Messages</h2></div>
    <div class="flex gap-2"><button id="msg-refresh" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold"><i class="fa-solid fa-rotate mr-2"></i>Actualiser</button>
    <button id="msg-new" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Nouvelle conversation</button></div></div>
    <div class="grid md:grid-cols-3 gap-4"><section class="bg-white rounded-2xl border border-slate-200 p-3 md:col-span-1"><div id="conv-list" class="space-y-1 text-sm max-h-[60vh] overflow-y-auto"></div></section>
    <section class="bg-white rounded-2xl border border-slate-200 p-4 md:col-span-2 flex flex-col min-h-[50vh]"><h3 id="thread-title" class="font-bold text-slate-800 mb-3">Choisissez une conversation</h3>
    <div id="thread" class="flex-1 space-y-2 overflow-y-auto max-h-[50vh] text-sm"></div>
    <form id="msg-form" class="hidden mt-3 flex gap-2" novalidate><input name="content" required maxlength="2000" autocomplete="off" placeholder="Votre message…" aria-label="Votre message" class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"><button class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Envoyer</button></form>
    <p id="msg-error" class="text-sm text-red-600 mt-2" role="alert"></p></section></div>`;
  async function loadConversations() {
    try {
      const list = rows(await get('/api/messages/conversations?limit=100'));
      $('conv-list').innerHTML = list.length ? list.map((c) => `<button type="button" data-conv="${escapeHtml(c.id)}" data-title="${escapeHtml(c.title)}" class="block w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 ${c.id === msgState.conversationId ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}"><span class="font-medium">${escapeHtml(c.title)}</span><span class="block text-xs text-slate-400">${c.type === 'group' ? 'Groupe' : 'Privée'} · ${displayDate(c.created_at)}</span></button>`).join('')
        : '<p class="p-3 text-slate-400">Aucune conversation. Créez la première.</p>';
    } catch (e) { $('conv-list').innerHTML = `<p class="p-3 text-red-500">${escapeHtml(e.message)}</p>`; }
  }
  // Accusés (ordonnance §4.1) : compteurs seulement, jamais l'identité des lecteurs.
  function receiptLabel(m) {
    if (!m.recipients_count) return 'Envoyé';
    return m.read_count >= m.recipients_count ? 'Lu par tous' : `Lu par ${m.read_count} sur ${m.recipients_count}`;
  }
  async function loadThread() {
    if (!msgState.conversationId) return;
    try {
      const list = rows(await get(`/api/messages/messages?conversation_id=${encodeURIComponent(msgState.conversationId)}&limit=100`)).reverse();
      $('thread').innerHTML = list.length ? list.map((m) => {
        const mine = session.user && m.sender_id === session.user.id;
        return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}"><div class="max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}"><p class="text-[11px] ${mine ? 'text-blue-100' : 'text-slate-500'}">${escapeHtml(m.sender_name || 'Utilisateur')} · ${new Date(m.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p><p class="whitespace-pre-wrap break-words">${escapeHtml(m.content)}</p>${mine ? `<p class="text-[11px] text-blue-100 mt-1">${receiptLabel(m)}</p>` : ''}</div></div>`;
      }).join('') : '<p class="text-slate-400">Aucun message. Écrivez le premier.</p>';
      $('thread').scrollTop = $('thread').scrollHeight;
      // Le destinataire accuse réception puis lecture de la conversation affichée (échecs silencieux : pas de droit = pas d'accusé).
      if (list.some((m) => m.sender_id !== (session.user && session.user.id))) {
        const base = `/api/messages/conversations/${encodeURIComponent(msgState.conversationId)}`;
        api('POST', `${base}/receive`).then(() => api('POST', `${base}/read`)).catch(() => {});
      }
    } catch (e) { $('thread').innerHTML = `<p class="text-red-500">${escapeHtml(e.message)}</p>`; }
  }
  async function select(id, title) {
    msgState.conversationId = id; $('thread-title').textContent = title; $('msg-form').classList.remove('hidden'); $('msg-error').textContent = '';
    await Promise.all([loadConversations(), loadThread()]);
    $('msg-form').content.focus();
  }
  $('conv-list').addEventListener('click', (ev) => { const b = ev.target.closest('[data-conv]'); if (b) select(b.dataset.conv, b.dataset.title); });
  $('msg-refresh').addEventListener('click', () => { loadConversations(); loadThread(); });
  const create = async () => {
    const ok = await formModal({ title: 'Nouvelle conversation', fields: MODULES.messages.fields, onSubmit: async (v) => { const r = await api('POST', '/api/messages/conversations', v); msgState.created = r.data; } });
    if (ok && msgState.created) { const c = msgState.created; msgState.created = null; await select(c.id, c.title); }
  };
  $('msg-new').addEventListener('click', create);
  $('msg-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = ev.currentTarget.content; const content = input.value.trim();
    if (!content) return;
    try { await api('POST', '/api/messages/messages', { conversation_id: msgState.conversationId, content }); input.value = ''; $('msg-error').textContent = ''; await loadThread(); }
    catch (e) { $('msg-error').textContent = e.message; }
  });
  await loadConversations();
  if (msgState.conversationId) { const b = moduleView.querySelector(`[data-conv="${msgState.conversationId}"]`); if (b) return select(b.dataset.conv, b.dataset.title); }
  if (opts.add) create();
}

// ---------------------------------------------------------------- Emploi du temps
const DAYS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [7, 'Dimanche']];
const ttState = { classId: '', mode: 'class', teacherId: '' };
async function openTimetable(opts = {}) {
  const writable = canWrite('timetable');
  moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-slate-500">Organisation des cours</p><h2 class="text-2xl font-bold text-slate-900">Emploi du temps</h2></div>
    <div class="flex flex-wrap gap-2 items-center"><select id="tt-mode" aria-label="Affichage" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="class">Par classe</option><option value="teacher">Par enseignant</option></select><select id="tt-class" aria-label="Classe" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"></select><select id="tt-teacher" aria-label="Enseignant" class="hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"></select>
    <button id="tt-print" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold">Imprimer</button>
    ${writable ? '<button id="tt-add" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Ajouter un cours</button>' : ''}</div></div>
    <section class="bg-white rounded-2xl border border-slate-200 p-4"><div id="tt-grid" class="overflow-x-auto"></div><p id="tt-error" class="text-sm text-red-600 mt-3" role="alert"></p></section>`;
  let classes = [];
  try { classes = rows(await get('/api/classes?limit=200')); } catch (e) { $('tt-error').textContent = e.message; }
  const sel = $('tt-class');
  sel.innerHTML = classes.length ? classes.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('') : '<option value="">Aucune classe</option>';
  if (classes.some((c) => c.id === ttState.classId)) sel.value = ttState.classId; else ttState.classId = sel.value;
  let teachers = [];
  try { teachers = rows(await get('/api/teachers?limit=200')); } catch (e) { /* la vue par enseignant restera vide */ }
  const tsel = $('tt-teacher');
  tsel.innerHTML = teachers.length ? teachers.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(`${t.first_name} ${t.last_name}`)}</option>`).join('') : '<option value="">Aucun enseignant</option>';
  if (teachers.some((t) => t.id === ttState.teacherId)) tsel.value = ttState.teacherId; else ttState.teacherId = tsel.value;
  $('tt-mode').value = ttState.mode;
  const syncMode = () => { const byT = ttState.mode === 'teacher'; sel.classList.toggle('hidden', byT); tsel.classList.toggle('hidden', !byT); };
  syncMode();

  async function draw() {
    const grid = $('tt-grid'); $('tt-error').textContent = '';
    const byTeacher = ttState.mode === 'teacher';
    if (!byTeacher && !ttState.classId) { grid.innerHTML = '<p class="p-4 text-slate-400">Créez d’abord une classe pour planifier ses cours.</p>'; return; }
    if (byTeacher && !ttState.teacherId) { grid.innerHTML = '<p class="p-4 text-slate-400">Aucun enseignant enregistré.</p>'; return; }
    grid.innerHTML = '<p class="p-4 text-slate-400">Chargement…</p>';
    try {
      const slots = rows(await get(`/api/timetable?${byTeacher ? `teacher_id=${encodeURIComponent(ttState.teacherId)}` : `class_id=${encodeURIComponent(ttState.classId)}`}&limit=200`));
      const days = DAYS.filter(([n]) => n <= 6 || slots.some((x) => x.day_of_week === n));
      grid.innerHTML = `<div class="grid gap-3" style="grid-template-columns: repeat(${days.length}, minmax(140px, 1fr));">${days.map(([n, name]) => `<div><h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">${name}</h4><div class="space-y-2">${
        slots.filter((x) => x.day_of_week === n).map((x) => `<div class="rounded-xl border border-blue-100 bg-blue-50/60 p-2.5 text-xs"><p class="font-bold text-blue-700">${escapeHtml(x.start_time)} – ${escapeHtml(x.end_time)}</p><p class="font-semibold text-slate-800 mt-0.5">${escapeHtml(x.subject)}</p><p class="text-slate-500">${byTeacher ? escapeHtml(x.class_name || '') : escapeHtml(x.teacher_name || 'Enseignant non précisé')}${x.room ? ` · ${escapeHtml(x.room)}` : ''}</p>${writable ? `<button type="button" data-del="${escapeHtml(x.id)}" class="mt-1 text-red-600 hover:underline">Supprimer</button>` : ''}</div>`).join('') || '<p class="text-xs text-slate-300">—</p>'}</div></div>`).join('')}</div>`;
    } catch (e) { grid.innerHTML = ''; $('tt-error').textContent = e.message; }
  }
  sel.addEventListener('change', () => { ttState.classId = sel.value; draw(); });
  tsel.addEventListener('change', () => { ttState.teacherId = tsel.value; draw(); });
  $('tt-mode').addEventListener('change', (e) => { ttState.mode = e.target.value; syncMode(); draw(); });
  $('tt-print').addEventListener('click', () => window.print());
  $('tt-grid').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    if (await confirmDialog('Supprimer le cours', 'Retirer ce créneau de l’emploi du temps ?')) {
      try { await api('DELETE', `/api/timetable/${encodeURIComponent(b.dataset.del)}`); toast('Cours supprimé.'); draw(); } catch (e) { toast(e.message, 'err'); }
    }
  });
  const add = async () => {
    const ok = await formModal({
      title: 'Ajouter un cours', values: { class_id: ttState.classId, day_of_week: '1' },
      fields: [{ name: 'class_id', label: 'Classe', type: 'class', required: true }, { name: 'subject', label: 'Matière', required: true },
        { name: 'day_of_week', label: 'Jour', type: 'select', required: true, options: DAYS.map(([n, name]) => [String(n), name]) },
        { name: 'start_time', label: 'Début', type: 'time', required: true }, { name: 'end_time', label: 'Fin', type: 'time', required: true },
        { name: 'teacher_id', label: 'Enseignant', type: 'teacher', clearable: true }, { name: 'room', label: 'Salle' }],
      onSubmit: (v) => api('POST', '/api/timetable', v)
    });
    if (ok) { toast('Cours ajouté.'); draw(); }
  };
  if (writable) $('tt-add').addEventListener('click', add);
  await draw();
  if (opts.add && writable) add();
}

// ---------------------------------------------------------------- Rapports
function reportTable(title, headers, items, render, empty = 'Aucune donnée.') {
  return `<section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">${title}</h3><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b">${headers.map((h) => `<th class="py-2 pr-3">${h}</th>`).join('')}</tr></thead><tbody>${items.length ? items.map(render).join('') : `<tr><td colspan="${headers.length}" class="py-4 text-center text-slate-400">${empty}</td></tr>`}</tbody></table></section>`;
}
async function openReports() {
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement des rapports…</p>';
  try {
    const d = (await get('/api/reports/overview')).data;
    const by = (arr, k) => arr.find((x) => x.label === k) || { total: 0, count: 0 };
    const pm = { paye: by(d.payments_by_status, 'paye'), wait: by(d.payments_by_status, 'en_attente') };
    const studentsTotal = d.students_by_class.reduce((a, x) => a + x.total, 0);
    moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-slate-500">Synthèses de l’établissement</p><h2 class="text-2xl font-bold text-slate-900">Rapports</h2></div>
      <div class="flex flex-wrap gap-2 items-end"><label class="text-xs font-semibold text-slate-600">Du<input id="rep-from" type="date" class="${INPUT_CLS}"></label><label class="text-xs font-semibold text-slate-600">Au<input id="rep-to" type="date" class="${INPUT_CLS}"></label>
      <button id="rep-csv" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="fa-solid fa-file-csv mr-2"></i>Exporter les paiements (CSV)</button><button id="rep-print" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold">Imprimer</button></div></div>
      <div class="grid sm:grid-cols-3 gap-4"><div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">Élèves inscrits</p><p class="text-2xl font-extrabold">${fmtNumber(studentsTotal)}</p></div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">Encaissé (payé)</p><p class="text-2xl font-extrabold text-emerald-600">${money(pm.paye.total)}</p></div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">En attente de règlement</p><p class="text-2xl font-extrabold text-amber-600">${money(pm.wait.total)}</p></div></div>
      <div class="grid lg:grid-cols-2 gap-4">
      ${reportTable('Élèves par classe', ['Classe', 'Effectif'], d.students_by_class, (x) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(x.label)}</td><td class="py-2">${fmtNumber(x.total)}</td></tr>`)}
      ${reportTable('Encaissements par type de frais', ['Frais', 'Paiements', 'Montant'], d.payments_by_fee, (x) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(x.label)}</td><td class="py-2 pr-3">${fmtNumber(x.count)}</td><td class="py-2">${money(x.total)}</td></tr>`)}
      ${reportTable('Présences — 30 derniers jours', ['Statut', 'Nombre'], d.attendance_30d, (x) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(label(x.label))}</td><td class="py-2">${fmtNumber(x.total)}</td></tr>`)}
      ${reportTable(`Moyennes par matière (sur ${d.grade_scale_max || 20})`, ['Matière', 'Moyenne', 'Notes'], d.grades_by_subject, (x) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(x.label)}</td><td class="py-2 pr-3 font-semibold">${String(x.average).replace('.', ',')}</td><td class="py-2">${fmtNumber(x.count)}</td></tr>`)}</div>`;
    $('rep-print').addEventListener('click', () => window.print());
    $('rep-csv').addEventListener('click', async () => {
      const q = new URLSearchParams(); if ($('rep-from').value) q.set('from', $('rep-from').value); if ($('rep-to').value) q.set('to', $('rep-to').value);
      try {
        const headers = { Authorization: `Bearer ${session.token}` };
        const res = await fetch(`/api/reports/payments.csv?${q}`, { headers });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a'); a.href = url; a.download = 'paiements.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) {
    moduleView.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 p-6"><h2 class="text-xl font-bold">Rapports</h2><p class="mt-3 text-red-600">${escapeHtml(e.status === 403 ? 'Les rapports sont réservés aux administrateurs et aux comptables.' : e.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------- Permissions par module et par rôle
const LEVEL_LABELS = { none: 'Aucun accès', read: 'Lecture', write: 'Lecture et modification' };
function permissionsSectionHtml() {
  return `<section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex flex-wrap items-center justify-between gap-2 mb-1"><h3 class="font-bold">Permissions par module</h3><button id="perm-reset" type="button" class="${BTN_LIGHT}">Rétablir les valeurs par défaut</button></div>
    <p class="text-sm text-slate-500 mb-3">Choisissez, pour chaque rôle, ce qui est accessible. L’administrateur a toujours tous les droits. Les modifications s’appliquent immédiatement. Les cases modifiées par rapport aux valeurs par défaut sont surlignées.</p>
    <div class="overflow-x-auto"><table class="w-full text-sm text-left" id="perm-table"><tbody><tr><td class="py-3 text-slate-400">Chargement…</td></tr></tbody></table></div>
    <p class="mt-3 text-xs text-slate-400">Attention : certains écrans s’appuient sur d’autres modules (par exemple la liste des classes pour l’emploi du temps ou les notes). Retirer la lecture d’un module peut donc limiter ces écrans.</p></section>`;
}
async function setupPermissions() {
  let data = (await get('/api/settings/permissions')).data;
  const draw = () => {
    $('perm-table').innerHTML = `<thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Module</th>${data.roles.map((r) => `<th class="py-2 pr-3">${escapeHtml(ROLE_LABELS[r] || r)}</th>`).join('')}</tr></thead><tbody>${Object.entries(data.modules).map(([m, label]) => `<tr class="border-b border-slate-100"><td class="py-2 pr-3 font-medium text-slate-800">${escapeHtml(label)}</td>${data.roles.map((r) => `<td class="py-1.5 pr-3"><select data-perm-role="${r}" data-perm-module="${m}" aria-label="${escapeHtml(`${label} — ${ROLE_LABELS[r] || r}`)}" class="rounded-lg border px-2 py-1.5 text-xs ${data.matrix[r][m] !== data.defaults[r][m] ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}">${data.levels.map((l) => `<option value="${l}" ${data.matrix[r][m] === l ? 'selected' : ''}>${LEVEL_LABELS[l]}</option>`).join('')}</select></td>`).join('')}</tr>`).join('')}</tbody>`;
  };
  draw();
  $('perm-table').addEventListener('change', async (e) => {
    const s = e.target.closest('select[data-perm-role]'); if (!s) return;
    try {
      await api('PUT', '/api/settings/permissions', { changes: [{ role: s.dataset.permRole, module: s.dataset.permModule, level: s.value }] });
      data = (await get('/api/settings/permissions')).data; draw(); toast('Permission enregistrée.');
    } catch (err) { toast(err.message, 'err'); data = (await get('/api/settings/permissions')).data; draw(); }
  });
  $('perm-reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Rétablir les permissions', 'Tous les rôles reviendront aux droits par défaut.'))) return;
    try { await api('DELETE', '/api/settings/permissions'); data = (await get('/api/settings/permissions')).data; draw(); toast('Valeurs par défaut rétablies.'); } catch (err) { toast(err.message, 'err'); }
  });
}

// ---------------------------------------------------------------- Paramètres
function gradingSectionHtml() {
  return `<section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-2">Barème des notes</h3><p class="text-sm text-slate-500 mb-3">Barème de l’établissement. Les mentions des bulletins restent définies sur 20. Le changement est refusé tant qu’une note dépasse le nouveau barème.</p><div class="flex flex-wrap items-center gap-2"><select id="grading-scale" class="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="20">Sur 20</option><option value="10">Sur 10</option></select><button id="grading-save" type="button" class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Enregistrer</button></div></section>`;
}

async function openSettings() {
  const isAdmin = session.user && ['admin', 'superadmin'].includes(session.user.role);
  const canReopen = isAdmin || session.user.role === 'gerant';
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement…</p>';
  let tenant = null;
  try { tenant = (await get('/api/settings')).data; } catch (e) { moduleView.innerHTML = `<p class="p-6 text-red-600">${escapeHtml(e.message)}</p>`; return; }
  moduleView.innerHTML = `<div><p class="text-sm text-slate-500">Configuration</p><h2 class="text-2xl font-bold text-slate-900">Paramètres</h2></div>
    <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Établissement</h3><p class="text-sm text-slate-500">Code de connexion : <strong class="text-slate-800">${escapeHtml(tenant.code)}</strong> · Statut : ${escapeHtml(tenant.status || '—')}</p>
      <p class="mt-2 text-sm">Nom : <strong id="tenant-name">${escapeHtml(tenant.name)}</strong> ${isAdmin ? '<button id="tenant-edit" class="ml-2 text-blue-600 hover:underline text-sm">Modifier</button>' : ''}</p></section>
    <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Mon compte</h3><p class="text-sm text-slate-500">${escapeHtml(session.user.email)} · ${escapeHtml(ROLE_LABELS[session.user.role] || session.user.role)}</p><button id="pwd-btn" class="mt-3 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Changer mon mot de passe</button></section>
    ${isAdmin ? gradingSectionHtml() : ''}
    ${isAdmin ? bannerManagerHtml() + identitySectionHtml(false) + subscriptionSectionHtml() + permissionsSectionHtml() : ''}
    ${canReopen ? `<section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-bold">Périodes scolaires (trimestres)</h3>${isAdmin ? `<button id="period-add" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Ajouter</button>` : ''}</div><div id="periods-list" class="text-sm space-y-2"></div><p class="mt-3 text-xs text-slate-400">Les périodes servent à filtrer les bulletins.</p></section>
    ${isAdmin ? `<section id="corrections-card" class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Corrections de notes en attente</h3><div id="corrections-list" class="text-sm"></div></section>` : ''}
    <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-bold">Utilisateurs</h3><button id="user-add" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Ajouter</button></div>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Nom</th><th class="py-2 pr-3">E-mail</th><th class="py-2 pr-3">Rôle</th><th class="py-2 pr-3">Dernière connexion</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody id="users-rows"></tbody></table></div>
      <p class="mt-3 text-xs text-slate-400">Un compte désactivé est déconnecté immédiatement. Un changement de rôle s’applique dès la requête suivante.</p></section>` : ''}`;
  $('pwd-btn').addEventListener('click', async () => {
    const ok = await formModal({ title: 'Changer mon mot de passe', fields: [{ name: 'current_password', label: 'Mot de passe actuel', type: 'password', required: true }, { name: 'new_password', label: 'Nouveau mot de passe (8 caractères minimum)', type: 'password', required: true }], onSubmit: (v) => api('POST', '/api/auth/password', v) });
    if (ok) toast('Mot de passe modifié.');
  });
  if (!canReopen) return;
  if (isAdmin) {
  setupBannerManager().catch((e) => toast(e.message, 'err'));
  setupIdentitySection('/api/settings/identity').catch((e) => toast(e.message, 'err'));
  setupSubscription().catch((e) => toast(e.message, 'err'));
  setupPermissions().catch((e) => toast(e.message, 'err'));
  $('tenant-edit').addEventListener('click', async () => {
    const ok = await formModal({ title: 'Nom de l’établissement', values: { name: tenant.name }, fields: [{ name: 'name', label: 'Nom', required: true }], onSubmit: async (v) => { tenant = (await api('PUT', '/api/settings', v)).data; } });
    if (ok) { $('tenant-name').textContent = tenant.name; toast('Établissement mis à jour.'); }
  });
  }
  async function loadCorrections() {
    const box = $('corrections-list');
    if (!box) return;
    try {
      const list = rows(await get('/api/grades/corrections'));
      box.innerHTML = list.length ? list.map((c) => `<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"><span><strong>${escapeHtml(c.student_name)}</strong> · ${escapeHtml(c.subject)} : ${escapeHtml(String(c.old_score))} → <strong>${escapeHtml(String(c.new_score))}</strong> <span class="text-slate-500">par ${escapeHtml(c.requested_by_name)} — « ${escapeHtml(c.reason)} »</span></span><span class="flex gap-3">${c.requested_by === session.user.id ? `<button type="button" data-correction-withdraw="${escapeHtml(c.id)}" class="text-slate-600 hover:underline">Retirer ma demande</button>` : `<button type="button" data-correction-approve="${escapeHtml(c.id)}" class="text-emerald-700 hover:underline">Approuver</button><button type="button" data-correction-reject="${escapeHtml(c.id)}" class="text-red-600 hover:underline">Refuser</button>`}</span></div>`).join('') : '<p class="text-slate-400">Aucune demande en attente.</p>';
    } catch (e) { box.innerHTML = `<p class="text-red-500">${escapeHtml(e.message)}</p>`; }
  }
  if ($('corrections-list')) $('corrections-list').addEventListener('click', async (ev) => {
    const ap = ev.target.closest('[data-correction-approve]');
    const rj = ev.target.closest('[data-correction-reject]');
    const wd = ev.target.closest('[data-correction-withdraw]');
    if (wd) {
      const done = await formModal({ title: 'Retirer ma demande de correction', fields: [{ name: 'reason', label: 'Motif (obligatoire)', required: true }], submit: 'Retirer', onSubmit: (v) => api('POST', `/api/grades/corrections/${encodeURIComponent(wd.dataset.correctionWithdraw)}/withdraw`, v) });
      if (done) { toast('Demande retirée.'); loadCorrections(); }
      return;
    }
    const b = ap || rj; if (!b) return;
    const decision = ap ? 'approve' : 'reject';
    const id = ap ? ap.dataset.correctionApprove : rj.dataset.correctionReject;
    const ok = await formModal({ title: ap ? 'Approuver la correction' : 'Refuser la correction', fields: [{ name: 'reason', label: 'Motif (obligatoire)', required: true }], submit: ap ? 'Approuver' : 'Refuser', onSubmit: (v) => api('POST', `/api/grades/corrections/${encodeURIComponent(id)}/${decision}`, v) });
    if (ok) { toast(ap ? 'Correction approuvée.' : 'Correction refusée.'); loadCorrections(); }
  });
  loadCorrections();
  async function loadPeriods() {
    const box = $('periods-list');
    try {
      const list = rows(await get('/api/periods?limit=50'));
      box.innerHTML = list.length ? list.map((p) => `<div class="flex items-center justify-between border-b border-slate-100 pb-2"><span><strong>${escapeHtml(p.name)}</strong> <span class="text-slate-500">du ${displayDate(p.start_date)} au ${displayDate(p.end_date)}</span></span><span class="flex items-center gap-3">${p.closed_at ? `<span class="text-xs font-semibold text-amber-700">Clôturée</span>${canReopen ? `<button type="button" data-period-reopen="${escapeHtml(p.id)}" class="text-blue-600 hover:underline">Rouvrir</button>` : ''}` : `${isAdmin ? `<button type="button" data-period-close="${escapeHtml(p.id)}" class="text-blue-600 hover:underline">Clôturer</button><button type="button" data-period-del="${escapeHtml(p.id)}" class="text-red-600 hover:underline">Supprimer</button>` : ''}`}</span></div>`).join('') : '<p class="text-slate-400">Aucune période définie.</p>';
    } catch (e) { box.innerHTML = `<p class="text-red-500">${escapeHtml(e.message)}</p>`; }
  }
  if ($('period-add')) $('period-add').addEventListener('click', async () => {
    if (await formModal({ title: 'Ajouter une période', fields: [{ name: 'name', label: 'Nom (ex. Trimestre 1)', required: true }, { name: 'start_date', label: 'Début', type: 'date', required: true }, { name: 'end_date', label: 'Fin', type: 'date', required: true }], onSubmit: (v) => api('POST', '/api/periods', v) })) { toast('Période ajoutée.'); loadPeriods(); }
  });
  $('periods-list').addEventListener('click', async (ev) => {
    const close = ev.target.closest('[data-period-close]');
    if (close) {
      if (await confirmDialog('Clôturer la période', 'Les notes dont la date tombe dans cette période ne pourront plus être ajoutées ni validées.')) {
        try { await api('POST', `/api/periods/${encodeURIComponent(close.dataset.periodClose)}/close`); toast('Période clôturée.'); loadPeriods(); } catch (e) { toast(e.message, 'err'); }
      }
      return;
    }
    const reopen = ev.target.closest('[data-period-reopen]');
    if (reopen) {
      const ok = await formModal({ title: 'Rouvrir la période', fields: [{ name: 'reason', label: 'Motif (obligatoire)', required: true }], submit: 'Rouvrir', onSubmit: (v) => api('POST', `/api/periods/${encodeURIComponent(reopen.dataset.periodReopen)}/reopen`, v) });
      if (ok) { toast('Période rouverte.'); loadPeriods(); }
      return;
    }
    const b = ev.target.closest('[data-period-del]'); if (!b) return;
    if (await confirmDialog('Supprimer la période', 'Les notes ne sont pas affectées ; seul le filtre du bulletin disparaît.')) {
      try { await api('DELETE', `/api/periods/${encodeURIComponent(b.dataset.periodDel)}`); toast('Période supprimée.'); loadPeriods(); } catch (e) { toast(e.message, 'err'); }
    }
  });
  loadPeriods();
  const USER_FIELDS = [{ name: 'email', label: 'Adresse e-mail', type: 'email', required: true }, { name: 'full_name', label: 'Nom complet', required: true },
    { name: 'role', label: 'Rôle', type: 'select', required: true, options: [['admin', 'Administrateur'], ['gerant', 'Gérant'], ['teacher', 'Enseignant'], ['accountant', 'Comptable'], ['user', 'Utilisateur']] },
    { name: 'password', label: 'Mot de passe initial (8 caractères minimum)', type: 'password', required: true }];
  let users = [];
  async function loadUsers() {
    const tbody = $('users-rows');
    try {
      users = rows(await get('/api/users?limit=200'));
      tbody.innerHTML = users.map((u) => `<tr class="border-b border-slate-100"><td class="py-2.5 pr-3">${escapeHtml(u.full_name)}</td><td class="py-2.5 pr-3">${escapeHtml(u.email)}</td><td class="py-2.5 pr-3">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</td><td class="py-2.5 pr-3 text-slate-500">${u.last_login_at ? new Date(u.last_login_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais'}</td><td class="py-2.5 pr-3">${u.is_active ? '<span class="text-emerald-700">Actif</span>' : '<span class="text-slate-400">Désactivé</span>'}</td><td class="py-2.5 text-right whitespace-nowrap">${u.id === session.user.id ? '<span class="text-xs text-slate-400">Vous</span>' : `${u.role === 'parent' ? '' : `<button type="button" data-user-role="${escapeHtml(u.id)}" class="text-blue-600 hover:underline mr-3">Rôle</button>`}<button type="button" data-user-pwd="${escapeHtml(u.id)}" class="text-blue-600 hover:underline mr-3">Mot de passe</button><button type="button" data-user-toggle="${escapeHtml(u.id)}" class="${u.is_active ? 'text-red-600' : 'text-emerald-700'} hover:underline">${u.is_active ? 'Désactiver' : 'Réactiver'}</button>`}</td></tr>`).join('');
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-red-500">${escapeHtml(e.message)}</td></tr>`; }
  }
  if (isAdmin) {
    get('/api/settings/grading').then((d) => { $('grading-scale').value = String(d.data.grade_scale_max); }).catch(() => {});
    $('grading-save').addEventListener('click', async () => {
      try {
        const d = await api('PUT', '/api/settings/grading', { grade_scale_max: Number($('grading-scale').value) });
        gradeScaleMax = d.data.grade_scale_max; toast('Barème enregistré.');
      } catch (e) { toast(e.message, 'err'); }
    });
  }
  // Comptes : réservés à l'administrateur (l'API refuse /api/users aux autres rôles) ; la section est retirée pour les autres.
  if (!isAdmin) document.getElementById('users-rows')?.closest('section')?.remove();
  if (isAdmin) $('user-add').addEventListener('click', async () => {
    if (await formModal({ title: 'Ajouter un utilisateur', fields: USER_FIELDS, onSubmit: (v) => api('POST', '/api/users', v) })) { toast('Utilisateur créé.'); loadUsers(); }
  });
  if (isAdmin) $('users-rows').addEventListener('click', async (ev) => {
    const r = ev.target.closest('[data-user-role]'), t = ev.target.closest('[data-user-toggle]'), w = ev.target.closest('[data-user-pwd]');
    const user = users.find((u) => u.id === (r ? r.dataset.userRole : w ? w.dataset.userPwd : t && t.dataset.userToggle)); if (!user) return;
    if (w) {
      if (await formModal({ title: `Nouveau mot de passe — ${user.full_name}`, fields: [{ name: 'new_password', label: 'Nouveau mot de passe (8 caractères minimum)', type: 'password', required: true }], onSubmit: (v) => api('PUT', `/api/users/${encodeURIComponent(user.id)}/password`, v) })) toast('Mot de passe réinitialisé. Communiquez-le à l’utilisateur.');
    } else if (r) {
      if (await formModal({ title: `Rôle de ${user.full_name}`, values: user, fields: [USER_FIELDS[2]], onSubmit: (v) => api('PUT', `/api/users/${encodeURIComponent(user.id)}`, v) })) { toast('Rôle modifié.'); loadUsers(); }
    } else if (await confirmDialog(user.is_active ? 'Désactiver le compte' : 'Réactiver le compte', `${user.full_name} (${user.email})`, user.is_active)) {
      try { await api('PUT', `/api/users/${encodeURIComponent(user.id)}`, { is_active: !user.is_active }); toast('Compte mis à jour.'); loadUsers(); } catch (e) { toast(e.message, 'err'); }
    }
  });
  if (isAdmin) await loadUsers();
}

// ---------------------------------------------------------------- Dossier individuel
function profileTable(title, headers, items, renderRow) {
  return `<section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">${title}</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="border-b text-slate-500">${headers.map((h) => `<th class="py-2 pr-3">${h}</th>`).join('')}</tr></thead><tbody>${items.length ? items.map(renderRow).join('') : `<tr><td colspan="${headers.length}" class="py-4 text-slate-400 text-center">Aucune donnée enregistrée.</td></tr>`}</tbody></table></div></section>`;
}
async function openStudentProfile(id) {
  showView();
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement du dossier individuel…</p>';
  try {
    const d = (await get(`/api/students/${encodeURIComponent(id)}/profile`)).data, s = d.student;
    const fullName = `${s.first_name || ''} ${s.last_name || ''}`.trim();
    const canGuardians = canWrite('students');
    const isAdminUser = session.user.role === 'admin';
    const parents = d.parents.map((p) => `<div class="rounded-xl bg-slate-50 p-3"><strong>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</strong><p class="text-sm text-slate-600">${escapeHtml(p.relationship || 'Responsable')} · ${escapeHtml(p.phone || 'Téléphone non renseigné')}</p><p class="text-sm text-slate-500">${escapeHtml(p.email || '')}</p>${p.is_primary ? '<span class="text-xs text-blue-700">Contact principal</span>' : ''}${canGuardians ? `<div class="no-print mt-2 flex flex-wrap gap-3 text-xs">${p.has_account ? `<span class="text-emerald-700"><i class="fa-solid fa-circle-check mr-1"></i>Accès parent : ${escapeHtml(p.account_email)}${p.account_active ? '' : ' (désactivé)'}</span><button type="button" data-guardian-revoke="${escapeHtml(p.id)}" class="text-red-600 hover:underline">Supprimer l’accès</button>` : `<button type="button" data-guardian-access="${escapeHtml(p.id)}" data-email="${escapeHtml(p.email || '')}" class="text-blue-600 hover:underline">Créer un accès parent</button>`}<button type="button" data-guardian-remove="${escapeHtml(p.id)}" class="text-slate-500 hover:underline">Retirer</button></div>${isAdminUser ? `<div class="no-print mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span>Accepte :</span>${[['notify_sms', 'SMS'], ['notify_whatsapp', 'WhatsApp'], ['notify_email', 'E-mail']].map(([k, l]) => `<label class="inline-flex items-center gap-1"><input type="checkbox" data-guardian-pref="${k}" data-parent="${escapeHtml(p.id)}" ${p[k] ? 'checked' : ''}>${l}</label>`).join('')}</div>` : ''}` : ''}</div>`).join('') || '<p class="text-sm text-slate-400">Aucun responsable légal associé.</p>';
    const photo = /^https?:\/\//.test(s.photo_url || '') && !s.has_photo ? `<img src="${escapeHtml(s.photo_url)}" alt="Photo de ${escapeHtml(fullName)}" class="w-full h-full object-cover" referrerpolicy="no-referrer">` : '<i class="fa-solid fa-user text-2xl text-slate-400"></i>';
    const canPhoto = canWrite('students');
    moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><button id="profile-back" class="text-sm text-blue-600 mb-2">← Retour à la liste</button><p class="text-sm text-slate-500">Dossier individuel de l’élève</p><h2 class="text-2xl font-bold">${escapeHtml(fullName)}</h2></div><div class="flex gap-2">${permOf('notifications') === 'write' && d.parents.length ? '<button id="profile-write" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-700 text-sm font-semibold">Écrire aux parents</button>' : ''}<button id="profile-card" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-700 text-sm font-semibold">Bulletin</button><button id="profile-print" class="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm font-semibold">Imprimer</button></div></div>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex flex-wrap gap-5 items-center"><div class="shrink-0"><div id="pf-photo" class="w-20 h-20 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center">${photo}</div>${canPhoto ? `<div class="no-print mt-2 text-xs text-center"><label class="text-blue-600 hover:underline cursor-pointer">Changer<input id="pf-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden"></label>${s.has_photo ? ' · <button id="pf-remove" type="button" class="text-red-600 hover:underline">Retirer</button>' : ''}</div><p id="pf-error" class="text-xs text-red-600 mt-1 max-w-[9rem]" role="alert"></p>` : ''}</div><div class="flex-1"><div class="text-sm text-slate-500">Matricule : ${escapeHtml(s.matricule || '—')}</div><div class="mt-1 text-sm">Classe : <strong>${escapeHtml(s.class_name || 'Non affecté')}</strong> ${escapeHtml(s.class_level || '')}</div><div class="mt-1 text-sm">Statut : ${escapeHtml(label(s.status) || '—')} · Année : ${escapeHtml(s.school_year || '—')}</div></div></div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5 text-sm"><div><span class="text-slate-500">Date de naissance</span><p class="font-medium">${displayDate(s.date_of_birth)}</p></div><div><span class="text-slate-500">Sexe</span><p class="font-medium">${escapeHtml(s.gender || '—')}</p></div><div><span class="text-slate-500">Téléphone d’urgence</span><p class="font-medium">${escapeHtml(s.emergency_phone || '—')}</p></div><div class="sm:col-span-2 lg:col-span-3"><span class="text-slate-500">Adresse</span><p class="font-medium">${escapeHtml(s.address || '—')}</p></div></div></section>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-bold">Parents et responsables</h3>${canGuardians ? '<button id="guardian-add" type="button" class="no-print text-sm text-blue-600 hover:underline">+ Ajouter un responsable</button>' : ''}</div><div id="guardian-list" class="grid sm:grid-cols-2 gap-3">${parents}</div></section>
      ${profileTable('Historique des notes', ['Date', 'Matière', 'Évaluation', 'Note', 'Statut'], d.grades, (g) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(g.date)}</td><td class="py-2 pr-3">${escapeHtml(g.subject)}</td><td class="py-2 pr-3">${escapeHtml(g.evaluation_type || '—')}</td><td class="py-2 pr-3">${escapeHtml(g.score)}</td><td class="py-2">${escapeHtml(label(g.status))}</td></tr>`)}
      ${profileTable('Historique des présences', ['Date', 'Classe', 'Statut', 'Observation'], d.attendances, (a) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(a.date)}</td><td class="py-2 pr-3">${escapeHtml(a.class_name || '—')}</td><td class="py-2 pr-3">${escapeHtml(label(a.status))}</td><td class="py-2">${escapeHtml(a.notes || '—')}</td></tr>`)}
      ${profileTable('Historique des paiements', ['Date', 'Type de frais', 'Montant', 'Mode', 'Statut', 'Reçu'], d.payments, (p) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(p.paid_at)}</td><td class="py-2 pr-3">${escapeHtml(p.fee_type || '—')}</td><td class="py-2 pr-3">${money(p.amount)}</td><td class="py-2 pr-3">${escapeHtml(p.method || '—')}</td><td class="py-2 pr-3">${escapeHtml(label(p.status))}</td><td class="py-2">${escapeHtml(p.receipt_number || '—')}</td></tr>`)}`;
    $('profile-back').addEventListener('click', () => openModule('students'));
    $('profile-print').addEventListener('click', () => window.print());
    $('profile-card').addEventListener('click', () => openReportCard(id));
    if ($('profile-write')) $('profile-write').addEventListener('click', () => { setActiveNav('broadcasts'); openBroadcasts({ audience: { type: 'student', id, label: `Parents de ${fullName}` } }); });
    if (s.has_photo) loadStudentPhoto(id);
    setupGuardians(id, isAdminUser);
    if ($('pf-file')) $('pf-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      $('pf-error').textContent = '';
      try { await uploadStudentPhoto(id, file); toast('Photo enregistrée.'); openStudentProfile(id); } catch (e) { $('pf-error').textContent = e.message; }
    });
    if ($('pf-remove')) $('pf-remove').addEventListener('click', async () => {
      if (!(await confirmDialog('Retirer la photo', 'Supprimer la photo de cet élève ?'))) return;
      try { await api('DELETE', `/api/students/${encodeURIComponent(id)}/photo`); toast('Photo retirée.'); openStudentProfile(id); } catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) {
    moduleView.innerHTML = `<div class="bg-white rounded-xl p-6"><p class="text-red-600">Dossier indisponible : ${escapeHtml(e.message)}</p><button id="profile-retry" class="mt-4 text-blue-600">Retour à la liste</button></div>`;
    $('profile-retry').addEventListener('click', () => openModule('students'));
  }
}


// Responsables d'un élève : ajout, retrait et accès au portail parent (création réservée à l'administrateur).
function setupGuardians(id, isAdminUser) {
  const reload = () => openStudentProfile(id);
  if ($('guardian-add')) $('guardian-add').addEventListener('click', async () => {
    if (await formModal({ title: 'Ajouter un responsable', fields: [{ name: 'first_name', label: 'Prénom', required: true }, { name: 'last_name', label: 'Nom', required: true },
      { name: 'relationship', label: 'Lien (père, mère, tuteur…)' }, { name: 'phone', label: 'Téléphone' }, { name: 'email', label: 'Adresse e-mail (sert d’identifiant du portail parent)', type: 'email' }],
      onSubmit: (v) => api('POST', `/api/students/${encodeURIComponent(id)}/parents`, v) })) { toast('Responsable ajouté.'); reload(); }
  });
  const list = $('guardian-list'); if (!list) return;
  list.addEventListener('change', async (ev) => {
    const c = ev.target.closest('[data-guardian-pref]'); if (!c) return;
    try { await api('PUT', `/api/parents/${encodeURIComponent(c.dataset.parent)}/preferences`, { [c.dataset.guardianPref]: c.checked }); toast('Préférence enregistrée.'); } catch (e) { c.checked = !c.checked; toast(e.message, 'err'); }
  });
  list.addEventListener('click', async (ev) => {
    const acc = ev.target.closest('[data-guardian-access]'), rev = ev.target.closest('[data-guardian-revoke]'), rm = ev.target.closest('[data-guardian-remove]');
    try {
      if (acc) {
        if (!isAdminUser) return toast('Seul l’administrateur peut créer un accès.', 'err');
        let created = null;
        const ok = await formModal({ title: 'Créer un accès parent', submit: 'Créer l’accès', values: { email: acc.dataset.email },
          fields: [{ name: 'email', label: 'Adresse e-mail (identifiant)', type: 'email', required: true }, { name: 'password', label: 'Mot de passe (laisser vide pour en générer un)', type: 'password' }],
          onSubmit: async (v) => { const body = { email: v.email }; if (v.password) body.password = v.password; created = (await api('POST', `/api/parents/${encodeURIComponent(acc.dataset.guardianAccess)}/account`, body)).data; } });
        if (ok && created) {
          await infoDialog('Accès créé', `Identifiant : ${created.email}${created.temp_password ? ` — Mot de passe provisoire (affiché une seule fois) : ${created.temp_password}` : ''}. Le parent se connecte avec le code de votre établissement.`);
          reload();
        }
      } else if (rev) {
        if (await confirmDialog('Supprimer l’accès parent', 'Le parent ne pourra plus se connecter. Sa fiche responsable est conservée.', true)) { await api('DELETE', `/api/parents/${encodeURIComponent(rev.dataset.guardianRevoke)}/account`); toast('Accès supprimé.'); reload(); }
      } else if (rm) {
        if (await confirmDialog('Retirer le responsable', 'Il ne sera plus rattaché à cet élève (et n’en verra plus le dossier).', true)) { await api('DELETE', `/api/students/${encodeURIComponent(id)}/parents/${encodeURIComponent(rm.dataset.guardianRemove)}`); toast('Responsable retiré.'); reload(); }
      }
    } catch (e) { toast(e.message, 'err'); }
  });
}

// Photo : l'image est protégée par le jeton, donc récupérée en blob (img-src autorise blob:).
async function loadStudentPhoto(id, base = '/api/students') {
  try {
    const res = await fetch(`${base}/${encodeURIComponent(id)}/photo`, { headers: authHeaders() });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const box = $('pf-photo'); if (box) box.innerHTML = `<img src="${url}" alt="Photo de l’élève" class="w-full h-full object-cover">`;
  } catch (e) { /* la silhouette par défaut reste affichée */ }
}
// Réduit la photo (800 px maximum, JPEG) avant l'envoi : une photo de téléphone dépasse sinon la limite de 1 Mo.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return reject(new Error('Format non accepté : utilisez une image PNG, JPEG ou WebP.'));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(128, Math.round(img.naturalWidth * k)); c.height = Math.max(128, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image illisible.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible ou corrompue.')); };
    img.src = url;
  });
}
async function uploadStudentPhoto(id, file) {
  const blob = await shrinkPhoto(file);
  const res = await fetch(`/api/students/${encodeURIComponent(id)}/photo`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'image/jpeg' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.errors) && data.errors.length ? data.errors.join(' ') : (data.error || `Erreur ${res.status}`));
}

// ---------------------------------------------------------------- Bulletin
// Téléchargement d'un fichier protégé par le jeton : récupéré en blob puis proposé à l'enregistrement.
async function downloadFile(url, name) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erreur ${res.status}`); }
  const link = document.createElement('a'); link.href = URL.createObjectURL(await res.blob()); link.download = name;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const DECISIONS = ['Félicitations', 'Encouragements', 'Tableau d’honneur', 'Avertissement travail', 'Avertissement conduite', 'Blâme'];
async function openReportCard(id, range = {}, portal = false) {
  const base = portal ? `/api/portal/children/${encodeURIComponent(id)}` : `/api/students/${encodeURIComponent(id)}`;
  const back = () => (portal ? openPortalChild(id) : openStudentProfile(id));
  showView();
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Calcul du bulletin…</p>';
  const q = new URLSearchParams(); if (range.from) q.set('from', range.from); if (range.to) q.set('to', range.to);
  try {
    const [cardRes, periodsRes] = await Promise.all([get(`${base}/report-card?${q}`), portal ? Promise.resolve({ data: [] }) : get('/api/periods?limit=50').catch(() => ({ data: [] }))]);
    const d = cardRes.data, s = d.student, periods = rows(periodsRes);
    const avg = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));
    const canComment = canWrite('grades');
    moduleView.innerHTML = `<div class="flex flex-wrap items-end justify-between gap-3"><div><button id="card-back" class="no-print text-sm text-blue-600 mb-2">← Retour au dossier</button><p class="text-sm text-slate-500">Bulletin de notes${s.school_year ? ` · ${escapeHtml(s.school_year)}` : ''}</p><h2 class="text-2xl font-bold">${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</h2><p class="text-sm text-slate-500">Matricule ${escapeHtml(s.matricule)} · ${escapeHtml(s.class_name || 'Sans classe')}</p></div>
      <div class="no-print flex flex-wrap gap-2 items-end">${periods.length ? `<label class="text-xs font-semibold text-slate-600">Période<select id="card-period" class="${INPUT_CLS}"><option value="">Personnalisée</option>${periods.map((p) => `<option value="${escapeHtml(p.start_date)}|${escapeHtml(p.end_date)}" ${p.start_date === range.from && p.end_date === range.to ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>` : ''}<label class="text-xs font-semibold text-slate-600">Du<input id="card-from" type="date" value="${escapeHtml(range.from || '')}" class="${INPUT_CLS}"></label><label class="text-xs font-semibold text-slate-600">Au<input id="card-to" type="date" value="${escapeHtml(range.to || '')}" class="${INPUT_CLS}"></label>
      <button id="card-apply" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700">Appliquer</button><button id="card-pdf" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold"><i class="fa-solid fa-file-pdf mr-2"></i>Télécharger le PDF</button><button id="card-print" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700">Imprimer</button></div></div>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Matière</th><th class="py-2 pr-3">Coef.</th><th class="py-2 pr-3">Notes</th><th class="py-2 pr-3">Moyenne /20</th><th class="py-2">Appréciation</th></tr></thead><tbody>${d.subjects.length ? d.subjects.map((x) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(x.subject)}</td><td class="py-2 pr-3">${fmtNumber(x.coefficient)}</td><td class="py-2 pr-3">${fmtNumber(x.notes)}</td><td class="py-2 pr-3 font-semibold">${avg(x.average)}</td><td class="py-2">${escapeHtml(x.mention || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="py-6 text-center text-slate-400">Aucune note sur cette période.</td></tr>'}</tbody></table></div></section>
      <div class="grid sm:grid-cols-3 gap-4"><div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">Moyenne générale</p><p class="text-2xl font-extrabold">${avg(d.overall_average)}</p></div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">Rang dans la classe</p><p class="text-2xl font-extrabold">${d.rank ? `${d.rank} / ${d.class_size}` : '—'}</p></div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5"><p class="text-xs text-slate-500">Appréciation</p><p class="text-2xl font-extrabold">${escapeHtml(d.mention || '—')}</p></div></div>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Appréciation de l’enseignant et décision du conseil</h3>
        ${canComment ? `<form id="card-comment" class="space-y-3 no-print" novalidate><label class="block text-xs font-semibold text-slate-600">Appréciation (600 caractères maximum)<textarea name="teacher_comment" rows="3" maxlength="600" class="${INPUT_CLS}">${escapeHtml(d.comment.teacher_comment || '')}</textarea></label>
          <label class="block text-xs font-semibold text-slate-600">Décision du conseil<select name="council_decision" class="${INPUT_CLS}"><option value="">—</option>${DECISIONS.map((x) => `<option ${d.comment.council_decision === x ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></label>
          <div class="flex items-center gap-3"><button class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Enregistrer</button><span id="card-comment-msg" class="text-sm text-emerald-700" role="status"></span></div></form>` : ''}
        <div class="${canComment ? 'hidden print:block' : ''} text-sm"><p id="card-comment-print" class="whitespace-pre-line text-slate-700">${escapeHtml(d.comment.teacher_comment || '')}</p><p id="card-decision-print" class="mt-2 font-semibold">${d.comment.council_decision ? `Décision du conseil : ${escapeHtml(d.comment.council_decision)}` : ''}</p></div>
        ${!canComment && !d.comment.teacher_comment && !d.comment.council_decision ? '<p class="text-sm text-slate-400">Aucune appréciation saisie.</p>' : ''}
        <div class="hidden print:grid grid-cols-2 gap-8 mt-10 text-sm text-slate-500"><div>Signature de l’enseignant</div><div>Signature du directeur</div></div></section>`;
    if ($('card-comment')) $('card-comment').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget; const body = { teacher_comment: f.teacher_comment.value.trim(), council_decision: f.council_decision.value };
      if (range.from) body.from = range.from; if (range.to) body.to = range.to;
      try { await api('PUT', `/api/students/${encodeURIComponent(id)}/report-card/comment`, body); $('card-comment-msg').textContent = 'Enregistré.'; $('card-comment-print').textContent = body.teacher_comment; $('card-decision-print').textContent = body.council_decision ? `Décision du conseil : ${body.council_decision}` : ''; }
      catch (e) { toast(e.message, 'err'); }
    });
    $('card-back').addEventListener('click', back);
    $('card-print').addEventListener('click', () => window.print());
    $('card-pdf').addEventListener('click', async () => {
      const q2 = new URLSearchParams(); if ($('card-from').value) q2.set('from', $('card-from').value); if ($('card-to').value) q2.set('to', $('card-to').value);
      try { await downloadFile(`${base}/report-card.pdf?${q2}`, `bulletin-${s.last_name}-${s.first_name}.pdf`); } catch (e) { toast(e.message, 'err'); }
    });
    if ($('card-period')) $('card-period').addEventListener('change', (ev) => { if (ev.target.value) { const [f, t] = ev.target.value.split('|'); openReportCard(id, { from: f, to: t }, portal); } });
    $('card-apply').addEventListener('click', () => openReportCard(id, { from: $('card-from').value, to: $('card-to').value }, portal));
  } catch (e) {
    moduleView.innerHTML = `<div class="bg-white rounded-xl p-6"><p class="text-red-600">Bulletin indisponible : ${escapeHtml(e.message)}</p><button id="card-retry" class="mt-4 text-blue-600">Retour</button></div>`;
    $('card-retry').addEventListener('click', back);
  }
}



// ---------------------------------------------------------------- Communication avec les parents (SMS, WhatsApp, e-mail)
const CH_LABELS = { email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp' };
async function openBroadcasts(opts = {}) {
  showView();
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement…</p>';
  try {
    const [chRes, clsRes, histRes, setRes, unpRes] = await Promise.all([get('/api/broadcasts/channels'), get('/api/classes?limit=200'), get('/api/broadcasts?limit=30'), get('/api/broadcasts/settings'), get('/api/broadcasts/unpaid')]);
    const ch = chRes.data, classes = rows(clsRes), hist = rows(histRes), absence = setRes.data.absence_channels, unpaid = unpRes.data, unpaidSet = setRes.data;
    const canSend = canWrite('notifications'), isAdmin = session.user.role === 'admin';
    const pre = opts.audience || null;
    const badge = (k) => `<span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${ch[k].available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}" ${ch[k].available ? '' : `title="${escapeHtml(ch[k].reason || '')}"`}><i class="fa-solid ${ch[k].available ? 'fa-circle-check' : 'fa-circle-minus'}"></i>${CH_LABELS[k]} : ${ch[k].available ? 'disponible' : 'indisponible'}</span>`;
    const chk = (k, name, checked) => `<label class="inline-flex items-center gap-2 text-sm ${ch[k].available ? '' : 'text-slate-400'}" ${ch[k].available ? '' : `title="${escapeHtml(ch[k].reason || '')}"`}><input type="checkbox" name="${name}" value="${k}" ${ch[k].available ? '' : 'disabled'} ${checked && ch[k].available ? 'checked' : ''}>${CH_LABELS[k]}</label>`;
    const unavailable = Object.keys(ch).filter((k) => !ch[k].available);
    moduleView.innerHTML = `<div><p class="text-sm text-slate-500">Parents et responsables</p><h2 class="text-2xl font-bold">Communication</h2></div>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex flex-wrap gap-2">${['email', 'sms', 'whatsapp'].map(badge).join('')}</div>
        ${unavailable.length ? `<p class="mt-3 text-xs text-slate-500">${unavailable.map((k) => CH_LABELS[k]).join(' et ')} : non configuré${unavailable.length > 1 ? 's' : ''} par la plateforme (le fournisseur SMS / WhatsApp et le serveur d’e-mails se règlent côté serveur). Les envois restent bloqués sur ces canaux. WhatsApp n’accepte un texte libre que dans les 24 h suivant un message du parent ; au-delà, un modèle approuvé est requis.</p>` : ''}</section>
      ${canSend ? `<section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Nouveau message</h3>
        <form id="bc-form" class="space-y-3" novalidate>
          <div class="grid sm:grid-cols-2 gap-3"><label class="block text-xs font-semibold text-slate-600">Destinataires
            <select name="type" class="${INPUT_CLS}">${pre && pre.type === 'student' ? `<option value="student" selected>${escapeHtml(pre.label)}</option>` : ''}<option value="all" ${pre ? '' : 'selected'}>Tous les parents</option><option value="class">Les parents d’une classe</option></select></label>
            <label id="bc-class-wrap" class="block text-xs font-semibold text-slate-600 hidden">Classe<select name="class_id" class="${INPUT_CLS}">${classes.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select></label></div>
          <div class="flex flex-wrap gap-4"><span class="text-xs font-semibold text-slate-600">Canaux</span>${['sms', 'whatsapp', 'email'].map((k) => chk(k, 'channels', true)).join('')}</div>
          <p id="bc-preview" class="text-xs text-slate-500" role="status"></p>
          <label class="block text-xs font-semibold text-slate-600">Objet (titre de l’e-mail)<input name="subject" maxlength="200" class="${INPUT_CLS}"></label>
          <label class="block text-xs font-semibold text-slate-600">Message<textarea name="body" rows="4" maxlength="1000" class="${INPUT_CLS}" placeholder="Bonjour {parent}, …"></textarea></label>
          <p class="text-xs text-slate-400">Variables : <code>{parent}</code> (prénom du responsable) et <code>{enfants}</code> (ses enfants concernés). SMS : 480 caractères maximum. <span id="bc-count"></span></p>
          <p id="bc-error" class="text-sm text-red-600" role="alert"></p>
          <button class="${BTN_PRIMARY}"><i class="fa-solid fa-paper-plane mr-2"></i>Envoyer</button></form></section>` : ''}
      ${isAdmin ? `<section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-1">Alerte automatique d’absence</h3><p class="text-sm text-slate-500 mb-3">Quand un élève est noté absent, ses responsables sont prévenus (une seule fois par jour et par élève).</p>
        <form id="abs-form" class="flex flex-wrap items-center gap-4">${['sms', 'whatsapp', 'email'].map((k) => chk(k, 'abs', absence.includes(k))).join('')}<button class="${BTN_LIGHT}">Enregistrer</button><span id="abs-msg" class="text-sm text-emerald-700" role="status"></span></form></section>` : ''}
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-1">Rappels d’impayés</h3><p class="text-sm text-slate-500 mb-3">Paiements « en attente » : ${unpaid.parents} responsable${unpaid.parents > 1 ? 's' : ''} concerné${unpaid.parents > 1 ? 's' : ''}, ${money(unpaid.total)} au total. Un seul message par responsable, avec le détail par enfant.</p>
        ${unpaid.rows.length ? `<div class="overflow-x-auto mb-3"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Responsable</th><th class="py-2 pr-3">Enfants</th><th class="py-2 pr-3">Montant</th><th class="py-2 pr-3">Ancienneté</th><th class="py-2">Joignable</th></tr></thead><tbody>${unpaid.rows.map((u) => `<tr class="border-b"><td class="py-2 pr-3">${escapeHtml(u.parent)}</td><td class="py-2 pr-3">${escapeHtml(u.children.join(', '))}</td><td class="py-2 pr-3 font-semibold">${money(u.amount)}</td><td class="py-2 pr-3">${u.oldest_days} j</td><td class="py-2 text-xs text-slate-500">${[u.sms && 'SMS', u.whatsapp && 'WhatsApp', u.email && 'e-mail'].filter(Boolean).join(', ') || '<span class="text-red-600">Aucun canal</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-sm text-slate-400 mb-3">Aucun impayé en attente.</p>'}
        ${canSend && unpaid.rows.length ? `<form id="unp-form" class="flex flex-wrap items-center gap-4"><span class="text-xs font-semibold text-slate-600">Relancer maintenant par</span>${['sms', 'whatsapp', 'email'].map((k) => chk(k, 'unp', k === 'sms')).join('')}<button class="${BTN_PRIMARY}">Envoyer les rappels</button></form>` : ''}
        ${isAdmin ? `<form id="unpset-form" class="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4"><span class="text-sm font-semibold">Rappels automatiques</span>${['sms', 'whatsapp', 'email'].map((k) => chk(k, 'unpset', unpaidSet.unpaid_channels.includes(k))).join('')}<label class="text-sm">après <input name="days" type="number" min="1" max="90" value="${unpaidSet.unpaid_after_days}" class="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm"> jours, puis 2 relances à 14 jours d’intervalle</label><button class="${BTN_LIGHT}">Enregistrer</button><span id="unpset-msg" class="text-sm text-emerald-700" role="status"></span></form>` : ''}</section>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Historique des envois</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Date</th><th class="py-2 pr-3">Destinataires</th><th class="py-2 pr-3">Objet</th><th class="py-2 pr-3">Canaux</th><th class="py-2 pr-3">Envoyés</th><th class="py-2">Échecs / ignorés</th></tr></thead>
        <tbody>${hist.length ? hist.map((b) => `<tr class="border-b"><td class="py-2 pr-3 whitespace-nowrap">${new Date(b.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="py-2 pr-3">${escapeHtml(b.audience_label || '—')}<span class="text-xs text-slate-400"> · ${b.recipients} resp.</span></td><td class="py-2 pr-3">${escapeHtml(b.subject)}</td><td class="py-2 pr-3">${b.channels.map((c) => CH_LABELS[c] || c).join(', ')}</td><td class="py-2 pr-3 text-emerald-700 font-semibold">${b.sent}</td><td class="py-2 ${b.failed ? 'text-red-600' : 'text-slate-500'}">${b.failed} / ${b.skipped}</td></tr>`).join('') : '<tr><td colspan="6" class="py-6 text-center text-slate-400">Aucun message envoyé.</td></tr>'}</tbody></table></div></section>`;
    const f = $('bc-form');
    if (f) {
      const aud = () => { const t = f.type.value; return t === 'class' ? { type: 'class', id: f.class_id.value } : t === 'student' ? { type: 'student', id: pre.id } : { type: 'all' }; };
      const refresh = async () => {
        $('bc-class-wrap').classList.toggle('hidden', f.type.value !== 'class');
        const a = aud(); const q = new URLSearchParams({ type: a.type }); if (a.id) q.set('id', a.id);
        try { const p = (await get(`/api/broadcasts/preview?${q}`)).data; $('bc-preview').textContent = `${p.guardians} responsable${p.guardians > 1 ? 's' : ''} concerné${p.guardians > 1 ? 's' : ''} · joignables : ${p.sms} par SMS, ${p.whatsapp} par WhatsApp, ${p.email} par e-mail.`; } catch (e) { $('bc-preview').textContent = e.message; }
      };
      f.type.addEventListener('change', refresh); f.class_id.addEventListener('change', refresh);
      f.body.addEventListener('input', () => { $('bc-count').textContent = `${f.body.value.length} caractères.`; });
      refresh();
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); $('bc-error').textContent = '';
        const channels = [...f.querySelectorAll('input[name=channels]:checked')].map((x) => x.value);
        if (!channels.length) return ($('bc-error').textContent = 'Choisissez au moins un canal disponible.');
        if (!f.subject.value.trim() || !f.body.value.trim()) return ($('bc-error').textContent = 'L’objet et le message sont obligatoires.');
        if (!(await confirmDialog('Envoyer le message', `${$('bc-preview').textContent} Envoyer par ${channels.map((c) => CH_LABELS[c]).join(', ')} ?`, false))) return;
        try {
          const r = (await api('POST', '/api/broadcasts', { audience: aud(), channels, subject: f.subject.value.trim(), body: f.body.value.trim() })).data;
          toast(`Envoyé : ${r.sent} message(s), ${r.failed} échec(s), ${r.skipped} ignoré(s) (coordonnée manquante ou refus du parent).`); openBroadcasts();
        } catch (e) { $('bc-error').textContent = e.message; }
      });
    }
    if ($('unp-form')) $('unp-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const channels = [...ev.currentTarget.querySelectorAll('input[name=unp]:checked')].map((x) => x.value);
      if (!channels.length) return toast('Choisissez au moins un canal disponible.', 'err');
      if (!(await confirmDialog('Envoyer les rappels', `${unpaid.parents} responsable(s) recevront un rappel par ${channels.map((c) => CH_LABELS[c]).join(', ')}.`, false))) return;
      try { const r = (await api('POST', '/api/broadcasts/unpaid', { channels })).data; toast(`Rappels : ${r.sent} envoyé(s), ${r.failed} échec(s), ${r.skipped} ignoré(s).`); openBroadcasts(); } catch (e) { toast(e.message, 'err'); }
    });
    if ($('unpset-form')) $('unpset-form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f2 = ev.currentTarget;
      try { await api('PUT', '/api/broadcasts/settings', { unpaid_channels: [...f2.querySelectorAll('input[name=unpset]:checked')].map((x) => x.value), unpaid_after_days: Number(f2.days.value) }); $('unpset-msg').textContent = 'Enregistré.'; } catch (e) { toast(e.message, 'err'); }
    });
    if ($('abs-form')) $('abs-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await api('PUT', '/api/broadcasts/settings', { absence_channels: [...ev.currentTarget.querySelectorAll('input[name=abs]:checked')].map((x) => x.value) }); $('abs-msg').textContent = 'Enregistré.'; } catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) { moduleView.innerHTML = `<div class="bg-white rounded-xl p-6 text-red-600">Communication indisponible : ${escapeHtml(e.message)}</div>`; }
}

// ---------------------------------------------------------------- Portail parent (lecture seule, enfants rattachés uniquement)
async function openPortal() {
  showView();
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement…</p>';
  try {
    const kids = rows(await get('/api/portal/children'));
    moduleView.innerHTML = `<div><p class="text-sm text-slate-500">Portail parent</p><h2 class="text-2xl font-bold">Mes enfants</h2></div>
      ${kids.length ? `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${kids.map((k) => `<button type="button" data-child="${escapeHtml(k.id)}" class="text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-400 hover:shadow-md transition"><div class="flex items-center gap-4"><div class="child-photo w-16 h-16 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center shrink-0" data-photo="${k.has_photo ? escapeHtml(k.id) : ''}"><i class="fa-solid fa-user text-xl text-slate-400"></i></div><div><p class="font-bold text-slate-900">${escapeHtml(k.first_name)} ${escapeHtml(k.last_name)}</p><p class="text-sm text-slate-500">${escapeHtml(k.class_name || 'Sans classe')}${k.school_year ? ` · ${escapeHtml(k.school_year)}` : ''}</p><p class="text-xs text-slate-400">Matricule ${escapeHtml(k.matricule)}</p></div></div></button>`).join('')}</div>`
        : '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">Aucun enfant n’est rattaché à votre compte. Contactez le secrétariat de l’établissement.</div>'}`;
    moduleView.querySelectorAll('[data-child]').forEach((b) => b.addEventListener('click', () => openPortalChild(b.dataset.child)));
    moduleView.querySelectorAll('[data-photo]').forEach((box) => { if (box.dataset.photo) loadPortalPhoto(box.dataset.photo, box); });
  } catch (e) { moduleView.innerHTML = `<div class="bg-white rounded-xl p-6 text-red-600">Portail indisponible : ${escapeHtml(e.message)}</div>`; }
}
async function loadPortalPhoto(id, box) {
  try {
    const res = await fetch(`/api/portal/children/${encodeURIComponent(id)}/photo`, { headers: authHeaders() });
    if (res.ok) box.innerHTML = `<img src="${URL.createObjectURL(await res.blob())}" alt="Photo" class="w-full h-full object-cover">`;
  } catch (e) { /* silhouette par défaut */ }
}
async function openPortalChild(id) {
  showView();
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement du dossier…</p>';
  try {
    const [pr, tt] = await Promise.all([get(`/api/portal/children/${encodeURIComponent(id)}`), get(`/api/portal/children/${encodeURIComponent(id)}/timetable`)]);
    const d = pr.data, s = d.student, name = `${s.first_name} ${s.last_name}`;
    const slots = rows(tt);
    const timetable = DAYS.filter(([n]) => slots.some((x) => x.day_of_week === n)).map(([n, lbl]) => `<div class="rounded-xl bg-slate-50 p-3"><p class="font-semibold text-sm mb-1">${lbl}</p>${slots.filter((x) => x.day_of_week === n).map((x) => `<p class="text-sm text-slate-700">${escapeHtml(x.start_time)}–${escapeHtml(x.end_time)} · ${escapeHtml(x.subject)}${x.room ? ` · ${escapeHtml(x.room)}` : ''}${x.teacher_name ? `<span class="text-slate-400"> · ${escapeHtml(x.teacher_name)}</span>` : ''}</p>`).join('')}</div>`).join('');
    moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><button id="child-back" class="text-sm text-blue-600 mb-2">← Mes enfants</button><p class="text-sm text-slate-500">Dossier scolaire</p><h2 class="text-2xl font-bold">${escapeHtml(name)}</h2></div><button id="child-card" class="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm font-semibold">Voir le bulletin</button></div>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex flex-wrap gap-5 items-center"><div id="child-photo" class="w-20 h-20 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center"><i class="fa-solid fa-user text-2xl text-slate-400"></i></div><div class="text-sm"><p class="text-slate-500">Matricule : ${escapeHtml(s.matricule || '—')}</p><p class="mt-1">Classe : <strong>${escapeHtml(s.class_name || 'Non affecté')}</strong> ${escapeHtml(s.class_level || '')}</p><p class="mt-1">Statut : ${escapeHtml(label(s.status) || '—')} · Année : ${escapeHtml(s.school_year || '—')}</p></div></div></section>
      <section class="bg-white rounded-2xl border border-slate-200 p-5"><h3 class="font-bold mb-3">Emploi du temps</h3>${timetable ? `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${timetable}</div>` : '<p class="text-sm text-slate-400">Aucun cours planifié pour cette classe.</p>'}</section>
      ${profileTable('Notes', ['Date', 'Matière', 'Évaluation', 'Note', 'Coef.'], d.grades, (g) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(g.date)}</td><td class="py-2 pr-3">${escapeHtml(g.subject)}</td><td class="py-2 pr-3">${escapeHtml(g.evaluation_type || '—')}</td><td class="py-2 pr-3">${escapeHtml(g.score)}</td><td class="py-2">${escapeHtml(g.coefficient ?? '—')}</td></tr>`)}
      ${profileTable('Présences et absences', ['Date', 'Statut', 'Observation'], d.attendances, (a) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(a.date)}</td><td class="py-2 pr-3">${escapeHtml(label(a.status))}</td><td class="py-2">${escapeHtml(a.notes || '—')}</td></tr>`)}
      ${profileTable('Paiements', ['Date', 'Type de frais', 'Montant', 'Mode', 'Reçu'], d.payments, (p) => `<tr class="border-b"><td class="py-2 pr-3">${displayDate(p.paid_at)}</td><td class="py-2 pr-3">${escapeHtml(p.fee_type || '—')}</td><td class="py-2 pr-3">${money(p.amount)}</td><td class="py-2 pr-3">${escapeHtml(p.method || '—')}</td><td class="py-2">${escapeHtml(p.receipt_number || '—')}${p.status === 'paye' ? ` <button type="button" data-rcpt="${escapeHtml(p.id)}" data-num="${escapeHtml(p.receipt_number || '')}" class="text-blue-600 hover:underline ml-2">PDF</button>` : ''}</td></tr>`)}`;
    $('child-back').addEventListener('click', openPortal);
    $('child-card').addEventListener('click', () => openReportCard(id, {}, true));
    moduleView.querySelectorAll('[data-rcpt]').forEach((b) => b.addEventListener('click', async () => { try { await downloadFile(`/api/portal/children/${encodeURIComponent(id)}/payments/${encodeURIComponent(b.dataset.rcpt)}/receipt.pdf`, `recu-${b.dataset.num || 'paiement'}.pdf`); } catch (e) { toast(e.message, 'err'); } }));
    if (s.has_photo) loadPortalPhoto(id, $('child-photo'));
  } catch (e) {
    moduleView.innerHTML = `<div class="bg-white rounded-xl p-6"><p class="text-red-600">Dossier indisponible : ${escapeHtml(e.message)}</p><button id="child-retry" class="mt-4 text-blue-600">Retour</button></div>`;
    $('child-retry').addEventListener('click', openPortal);
  }
}

// ---------------------------------------------------------------- Recherche, navigation, actions rapides
(function setupSearch() {
  const input = $('global-search'), box = $('search-results');
  let timer;
  const hide = () => box.classList.add('hidden');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return hide();
    timer = setTimeout(async () => {
      try {
        const list = rows(await get(`/api/students?q=${encodeURIComponent(q)}&limit=6`));
        box.innerHTML = list.length
          ? list.map((s) => `<button type="button" data-id="${escapeHtml(s.id)}" class="block w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"><span class="font-medium text-slate-800">${escapeHtml(s.last_name)} ${escapeHtml(s.first_name)}</span> <span class="text-xs text-slate-400">${escapeHtml(s.matricule)} · ${escapeHtml(s.class_name || 'Sans classe')}</span></button>`).join('')
          : '<p class="px-4 py-3 text-slate-400">Aucun élève correspondant.</p>';
        box.classList.remove('hidden');
      } catch (e) { box.innerHTML = `<p class="px-4 py-3 text-red-500">${escapeHtml(e.message)}</p>`; box.classList.remove('hidden'); }
    }, 250);
  });
  box.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-id]'); if (b) { hide(); input.value = ''; openStudentProfile(b.dataset.id); } });
  document.addEventListener('click', (ev) => { if (!$('search-box').contains(ev.target)) hide(); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
})();

document.addEventListener('click', (ev) => {
  const link = ev.target.closest('[data-module]');
  if (link) {
    ev.preventDefault();
    if (link.dataset.module === 'dashboard') { showDashboard(); loadDashboard(); } else openModule(link.dataset.module);
    if (window.innerWidth < 1024) closeSidebar();
    return;
  }
  const act = ev.target.closest('[data-action]');
  if (!act) return;
  const a = act.dataset.action;
  if (a === 'add-student') openModule('students', { add: true });
  else if (a === 'timetable') openTimetable();
  else if (a === 'report-card') openModule('reports');
  else if (a === 'add-payment') openModule('payments', { add: true });
  else if (a === 'stocks') openModule('stocks');
  else if (a === 'reports') openModule('reports');
  else if (a === 'assign-class') openModule('students');
  else if (a === 'enter-grades') openModule('grades', { add: true });
  else if (a === 'message') openModule('messages', { add: true });
});

// Mobile / tablette (< 1024 px) : menu en panneau par-dessus le contenu, fermé au départ, avec fond cliquable.
const isNarrow = () => window.innerWidth < 1024;
function syncBackdrop() { $('sidebar-backdrop').classList.toggle('hidden', !(isNarrow() && !$('sidebar').classList.contains('hidden'))); }
function closeSidebar() { $('sidebar').classList.add('hidden'); syncBackdrop(); }
$('toggle-sidebar').addEventListener('click', () => { $('sidebar').classList.toggle('hidden'); syncBackdrop(); });
$('sidebar-backdrop').addEventListener('click', closeSidebar);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isNarrow()) closeSidebar(); });
if (isNarrow()) closeSidebar();
let wasNarrow = isNarrow();
window.addEventListener('resize', () => { const n = isNarrow(); if (n !== wasNarrow) { wasNarrow = n; if (n) closeSidebar(); else { $('sidebar').classList.remove('hidden'); syncBackdrop(); } } });

// ---------------------------------------------------------------- Espace superadmin (plateforme)
// Le superadmin gère les établissements, les packs et les licences. Il n'a aucun accès aux données privées des écoles.
const LICENSE_BADGES = {
  ok: ['Active', 'bg-emerald-50 text-emerald-700'], unlimited: ['Illimitée', 'bg-slate-100 text-slate-600'],
  expiring: ['Expire bientôt', 'bg-amber-50 text-amber-700'], expired: ['Expirée', 'bg-red-50 text-red-700'], suspended: ['Suspendu', 'bg-red-50 text-red-700']
};
const licenseBadge = (state) => { const b = LICENSE_BADGES[state] || ['—', 'bg-slate-100 text-slate-600']; return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${b[1]}">${b[0]}</span>`; };
const quotaText = (used, max) => `${fmtNumber(used)} / ${max === null || max === undefined ? '∞' : fmtNumber(max)}`;
const quotaWarn = (used, max) => max && Number(used) >= 0.9 * max;
const PLATFORM_ACTIONS = {
  'platform.tenant_create': 'Établissement créé', 'platform.tenant_update': 'Établissement modifié', 'platform.tenant_suspend': 'Établissement suspendu',
  'platform.tenant_reactivate': 'Établissement réactivé', 'platform.license_renew': 'Licence renouvelée', 'platform.plan_apply': 'Pack appliqué',
  'platform.plan_create': 'Pack créé', 'platform.plan_update': 'Pack modifié', 'platform.admin_password': 'Mot de passe administrateur réinitialisé',
  'platform.admin_enable': 'Administrateur réactivé', 'platform.admin_disable': 'Administrateur désactivé', 'platform.invoice_create': 'Facture créée', 'platform.invoice_pay': 'Facture encaissée', 'platform.invoice_cancel': 'Facture annulée', 'platform.credit_note': 'Avoir émis', 'platform.invoice_send': 'Facture envoyée par e-mail', 'platform.mail_test': 'E-mail de test', 'platform.reminders_run': 'Rappels exécutés', 'platform.billing_settings': 'Réglages de facturation modifiés', 'auth.password_reset': 'Mot de passe réinitialisé', 'student.report_comment': 'Appréciation de bulletin', 'student.photo': 'Photo d’élève modifiée', 'settings.permissions': 'Permissions modifiées', 'settings.permissions_reset': 'Permissions rétablies par défaut', 'student.photo_remove': 'Photo d’élève retirée', 'platform.identity.logo': 'Logo de la plateforme modifié', 'platform.identity.logo_remove': 'Logo de la plateforme retiré', 'platform.identity.text': 'Identité de la plateforme modifiée', 'platform.identity.reset': 'Identité de la plateforme réinitialisée', 'identity.logo': 'Logo modifié', 'identity.logo_remove': 'Logo retiré', 'identity.text': 'Identité modifiée', 'identity.reset': 'Identité réinitialisée', 'auth.login': 'Connexion', 'auth.password_change': 'Mot de passe modifié'
};
const platformTitle = (kicker, title, actions = '') => `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-slate-500">${kicker}</p><h2 class="text-2xl font-bold text-slate-900">${title}</h2></div><div class="flex gap-2">${actions}</div></div>`;
const CARD = 'bg-white rounded-2xl border border-slate-200 p-5';
const BTN = 'px-4 py-2 rounded-lg text-sm font-semibold';
const BTN_PRIMARY = `${BTN} bg-blue-600 hover:bg-blue-700 text-white`;
const BTN_LIGHT = `${BTN} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

async function showTempPassword(title, who, pwd) {
  await infoDialog(title, `Mot de passe temporaire pour ${who} : ${pwd} — transmettez-le à l’administrateur de l’établissement. Il ne sera plus affiché.`);
}

async function openPlatform(key, opts = {}) {
  moduleView.innerHTML = '<p class="p-6 text-slate-500">Chargement…</p>';
  try {
    if (key === 'platform-overview') return await platformOverview();
    if (key === 'platform-tenants') return opts.tenantId ? await platformTenantDetail(opts.tenantId) : await platformTenants();
    if (key === 'platform-plans') return await platformPlans();
    if (key === 'platform-audit') return await platformAudit();
    if (key === 'platform-billing') return await platformBilling();
    if (key === 'platform-identity') return await platformIdentity();
    if (key === 'platform-mail') return await platformMail();
    if (key === 'platform-account') return platformAccount();
    moduleView.innerHTML = '<p class="p-6 text-slate-500">Section inconnue.</p>';
  } catch (e) { moduleView.innerHTML = `<p class="p-6 text-red-600">${escapeHtml(e.message)}</p>`; }
}

async function platformOverview() {
  const d = (await get('/api/platform/overview')).data;
  const kpi = (icon, color, value, text) => `<div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex items-center space-x-3.5"><div class="w-11 h-11 shrink-0 ${color} rounded-xl flex items-center justify-center text-white"><i class="fa-solid ${icon}"></i></div><div><div class="text-2xl font-bold text-slate-900 leading-none mb-1">${fmtNumber(value)}</div><div class="text-xs font-medium text-slate-500">${text}</div></div></div>`;
  const list = (items, empty, fmt) => (items.length ? items.map(fmt).join('') : `<p class="text-sm text-slate-400">${empty}</p>`);
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Vue d’ensemble', `<button id="pl-new" class="${BTN_PRIMARY}"><i class="fa-solid fa-plus mr-2"></i>Nouvel établissement</button>`)}
    <p class="text-xs text-slate-500 -mt-2">Vue réservée à la gestion de la plateforme : seuls des compteurs d’usage sont affichés, jamais les données privées des établissements.</p>
    <div id="pl-kpis" class="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      ${kpi('fa-school', 'bg-blue-600', d.tenants, 'Établissements')}${kpi('fa-circle-check', 'bg-emerald-500', d.active, 'Actifs')}${kpi('fa-ban', 'bg-red-500', d.suspended, 'Suspendus')}
      ${kpi('fa-calendar-xmark', 'bg-rose-500', d.expired, 'Licences expirées')}${kpi('fa-hourglass-half', 'bg-amber-500', d.expiring, 'Expirent sous 30 j')}
      ${kpi('fa-users', 'bg-violet-500', d.students_total, 'Élèves (total)')}${kpi('fa-user-shield', 'bg-teal-500', d.users_total, 'Utilisateurs (total)')}</div>
    <div id="pl-billing" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${[['Encaissé ce mois', d.billing.paid_month, 'text-emerald-700'], ['Encaissé cette année', d.billing.paid_year, 'text-emerald-700'], ['Factures en attente', d.billing.pending_total, 'text-amber-700'], [`En retard (${d.billing.overdue_count})`, d.billing.overdue_total, 'text-red-700']]
        .map(([t, v, c]) => `<button data-go="platform-billing" class="text-left bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm hover:border-blue-300"><div class="text-xs font-medium text-slate-500">${t}</div><div class="text-xl font-bold ${c}">${money(v)}</div></button>`).join('')}</div>
    <div class="grid lg:grid-cols-2 gap-4">
      <section class="${CARD}"><h3 class="font-bold mb-3">Licences à renouveler</h3><div class="space-y-2">${list(d.expiring_list, 'Aucune licence à renouveler.', (t) => `<div class="flex items-center justify-between text-sm border-b border-slate-100 pb-2"><button data-open="${escapeHtml(t.id)}" class="text-left font-semibold text-blue-700 hover:underline">${escapeHtml(t.name)}</button><span>${licenseBadge(t.license_state)} <span class="text-slate-500 ml-1">${displayDate(t.license_end)}</span></span></div>`)}</div></section>
      <section class="${CARD}"><h3 class="font-bold mb-3">Quotas presque atteints (≥ 90 %)</h3><div class="space-y-2">${list(d.near_quota, 'Aucun établissement proche de sa limite.', (t) => `<div class="flex items-center justify-between text-sm border-b border-slate-100 pb-2"><button data-open="${escapeHtml(t.id)}" class="text-left font-semibold text-blue-700 hover:underline">${escapeHtml(t.name)}</button><span class="text-slate-600">Élèves ${quotaText(t.students_count, t.max_students)} · Utilisateurs ${quotaText(t.users_count, t.max_users)}</span></div>`)}</div></section>
    </div>
    <section class="${CARD}"><h3 class="font-bold mb-3">Dernières actions</h3><div class="space-y-2">${list(d.recent, 'Aucune action enregistrée.', (a) => `<div class="flex justify-between text-sm border-b border-slate-100 pb-2"><span>${escapeHtml(PLATFORM_ACTIONS[a.action] || 'Action enregistrée')}${a.details && a.details.name ? ` — ${escapeHtml(a.details.name)}` : ''}</span><span class="text-slate-400">${escapeHtml(a.user_name || '')} · ${new Date(a.created_at).toLocaleString('fr-FR')}</span></div>`)}</div></section>`;
  $('pl-new').addEventListener('click', () => newTenantForm());
  moduleView.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { setActiveNav(b.dataset.go); openPlatform(b.dataset.go); }));
  moduleView.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { setActiveNav('platform-tenants'); openPlatform('platform-tenants', { tenantId: b.dataset.open }); }));
}

async function planOptions(onlyActive = true) {
  const plans = rows(await get('/api/platform/plans'));
  return plans.filter((p) => !onlyActive || p.is_active).map((p) => [p.id, `${p.name} — ${p.max_students ?? '∞'} élèves, ${p.max_users ?? '∞'} utilisateurs`]);
}

async function newTenantForm() {
  const options = await planOptions();
  const ok = await formModal({
    title: 'Nouvel établissement', submit: 'Créer',
    fields: [
      { name: 'code', label: 'Code de connexion (lettres, chiffres, - _)', required: true }, { name: 'name', label: 'Nom de l’établissement', required: true },
      { name: 'city', label: 'Ville' }, { name: 'contact_name', label: 'Contact (nom)' }, { name: 'contact_email', label: 'Contact (e-mail)', type: 'email' }, { name: 'contact_phone', label: 'Contact (téléphone)' },
      { name: 'plan_id', label: 'Pack', type: 'select', options }, { name: 'license_start', label: 'Début de licence', type: 'date' }, { name: 'license_end', label: 'Fin de licence', type: 'date' },
      { name: 'contract_ref', label: 'Référence du contrat' },
      { name: 'admin_full_name', label: 'Administrateur : nom complet', required: true }, { name: 'admin_email', label: 'Administrateur : e-mail', type: 'email', required: true },
      { name: 'admin_password', label: 'Administrateur : mot de passe (vide = généré automatiquement)', type: 'password' }
    ],
    onSubmit: async (v) => { newTenantForm.result = (await api('POST', '/api/platform/tenants', v)).data; }
  });
  if (!ok) return;
  const t = newTenantForm.result;
  toast('Établissement créé.');
  if (t.temporary_password) await showTempPassword('Établissement créé', t.name, t.temporary_password);
  setActiveNav('platform-tenants');
  openPlatform('platform-tenants', { tenantId: t.id });
}

const tenantFilter = { q: '', status: '' };
async function platformTenants() {
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Établissements', `<button id="pl-csv" class="${BTN_LIGHT}"><i class="fa-solid fa-file-csv mr-2"></i>Exporter (CSV)</button><button id="pl-new" class="${BTN_PRIMARY}"><i class="fa-solid fa-plus mr-2"></i>Nouvel établissement</button>`)}
    <section class="${CARD}"><div class="flex flex-wrap gap-2 mb-4"><input id="pl-q" type="search" placeholder="Nom, code ou ville…" value="${escapeHtml(tenantFilter.q)}" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Rechercher un établissement">
      <select id="pl-status" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Filtrer par statut"><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="suspended">Suspendus</option><option value="preparation">En préparation</option></select></div>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Établissement</th><th class="py-2 pr-3">Pack</th><th class="py-2 pr-3">Licence</th><th class="py-2 pr-3">Élèves</th><th class="py-2 pr-3">Utilisateurs</th><th class="py-2"></th></tr></thead><tbody id="pl-rows"><tr><td class="py-3 text-slate-400" colspan="6">Chargement…</td></tr></tbody></table></div></section>`;
  $('pl-status').value = tenantFilter.status;
  $('pl-new').addEventListener('click', () => newTenantForm());
  $('pl-csv').addEventListener('click', () => downloadFile('/api/platform/tenants.csv', 'etablissements.csv'));
  async function load() {
    const qs = new URLSearchParams({ limit: '100' });
    if (tenantFilter.q) qs.set('q', tenantFilter.q);
    if (tenantFilter.status) qs.set('status', tenantFilter.status);
    const list = rows(await get(`/api/platform/tenants?${qs}`));
    $('pl-rows').innerHTML = list.length ? list.map((t) => `<tr class="border-b border-slate-100"><td class="py-3 pr-3"><div class="font-semibold text-slate-900">${escapeHtml(t.name)}</div><div class="text-xs text-slate-500">${escapeHtml(t.code)}${t.city ? ` · ${escapeHtml(t.city)}` : ''}</div></td>
      <td class="py-3 pr-3">${escapeHtml(t.plan_name || '—')}</td><td class="py-3 pr-3">${licenseBadge(t.license_state)}<div class="text-xs text-slate-500 mt-0.5">${t.license_end ? `jusqu’au ${displayDate(t.license_end)}` : ''}</div></td>
      <td class="py-3 pr-3 ${quotaWarn(t.students_count, t.max_students) ? 'text-amber-700 font-semibold' : ''}">${quotaText(t.students_count, t.max_students)}</td>
      <td class="py-3 pr-3 ${quotaWarn(t.users_count, t.max_users) ? 'text-amber-700 font-semibold' : ''}">${quotaText(t.users_count, t.max_users)}</td>
      <td class="py-3 text-right"><button data-open="${escapeHtml(t.id)}" class="${BTN_LIGHT}">Gérer</button></td></tr>`).join('') : '<tr><td class="py-4 text-slate-400" colspan="6">Aucun établissement.</td></tr>';
  }
  let timer;
  $('pl-q').addEventListener('input', (e) => { tenantFilter.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(() => load().catch((x) => toast(x.message, 'err')), 250); });
  $('pl-status').addEventListener('change', (e) => { tenantFilter.status = e.target.value; load().catch((x) => toast(x.message, 'err')); });
  $('pl-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openPlatform('platform-tenants', { tenantId: b.dataset.open }); });
  await load();
}

async function platformTenantDetail(id) {
  const t = (await get(`/api/platform/tenants/${encodeURIComponent(id)}`)).data;
  const line = (k, v) => `<div class="flex justify-between gap-4 py-1.5 border-b border-slate-100 text-sm"><span class="text-slate-500">${k}</span><span class="font-medium text-slate-800 text-right">${v}</span></div>`;
  const suspended = t.status === 'suspended';
  const invs = rows(await get(`/api/platform/invoices?tenant_id=${encodeURIComponent(id)}&limit=20`));
  moduleView.innerHTML = `${platformTitle('Établissement', escapeHtml(t.name), `<button id="pl-back" class="${BTN_LIGHT}"><i class="fa-solid fa-arrow-left mr-2"></i>Retour</button>`)}
    ${suspended ? `<div class="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-3" role="status"><strong>Établissement suspendu</strong>${t.suspended_reason ? ` : ${escapeHtml(t.suspended_reason)}` : ''}. Ses utilisateurs ne peuvent plus se connecter ; les données sont conservées.</div>` : ''}
    <div class="grid lg:grid-cols-2 gap-4">
      <section class="${CARD}"><div class="flex justify-between items-center mb-2"><h3 class="font-bold">Identité et contact</h3><button id="pl-edit" class="text-blue-600 hover:underline text-sm">Modifier</button></div>
        ${line('Code de connexion', escapeHtml(t.code))}${line('Ville', escapeHtml(t.city || '—'))}${line('Contact', escapeHtml(t.contact_name || '—'))}${line('E-mail', escapeHtml(t.contact_email || '—'))}${line('Téléphone', escapeHtml(t.contact_phone || '—'))}${line('Contrat', escapeHtml(t.contract_ref || '—'))}${line('Notes', escapeHtml(t.notes || '—'))}</section>
      <section class="${CARD}"><div class="flex justify-between items-center mb-2"><h3 class="font-bold">Pack, licence et quotas</h3><button id="pl-license" class="text-blue-600 hover:underline text-sm">Modifier</button></div>
        ${line('Pack', escapeHtml(t.plan_name || 'Aucun'))}${line('Licence', `${licenseBadge(t.license_state)}`)}${line('Période', `${t.license_start ? displayDate(t.license_start) : '—'} → ${t.license_end ? displayDate(t.license_end) : 'sans fin'}`)}
        ${line('Élèves', quotaText(t.students_count, t.max_students))}${line('Utilisateurs', quotaText(t.users_count, t.max_users))}
        <div class="flex flex-wrap gap-2 mt-3"><span class="text-xs text-slate-500 self-center">Renouveler de :</span>${[3, 6, 12].map((m) => `<button data-renew="${m}" class="${BTN_LIGHT}">${m} mois</button>`).join('')}<button id="pl-plan" class="${BTN_LIGHT}">Appliquer un pack…</button></div></section>
    </div>
    <section class="${CARD}"><h3 class="font-bold mb-3">Administrateurs de l’établissement</h3>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Nom</th><th class="py-2 pr-3">E-mail</th><th class="py-2 pr-3">Dernière connexion</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody>
      ${t.admins.length ? t.admins.map((a) => `<tr class="border-b border-slate-100"><td class="py-2 pr-3">${escapeHtml(a.full_name || '—')}</td><td class="py-2 pr-3">${escapeHtml(a.email)}</td><td class="py-2 pr-3 text-slate-500">${a.last_login_at ? new Date(a.last_login_at).toLocaleString('fr-FR') : 'jamais'}</td><td class="py-2 pr-3">${a.is_active ? 'Actif' : '<span class="text-red-600">Désactivé</span>'}</td>
        <td class="py-2 text-right whitespace-nowrap"><button data-pwd="${escapeHtml(a.id)}" data-who="${escapeHtml(a.email)}" class="${BTN_LIGHT}">Mot de passe</button> <button data-toggle="${escapeHtml(a.id)}" data-active="${a.is_active ? '1' : '0'}" class="${BTN_LIGHT}">${a.is_active ? 'Désactiver' : 'Réactiver'}</button></td></tr>`).join('') : '<tr><td colspan="5" class="py-3 text-slate-400">Aucun administrateur.</td></tr>'}</tbody></table></div>
      <p class="mt-3 text-xs text-slate-400">Le superadmin ne crée pas les employés : l’administrateur de l’établissement gère ses propres utilisateurs.</p></section>
    <section class="${CARD}"><h3 class="font-bold mb-1">Apparence de l’établissement</h3><p class="text-xs text-slate-400 mb-3">Nom, slogan, logo et affiche de l’établissement. Le logo et le nom du site ne se modifient pas ici.</p>${identitySectionHtml(false)}${bannerSectionHtml()}</section>
    <section class="${CARD}"><div class="flex justify-between items-center mb-3"><h3 class="font-bold">Factures d’abonnement</h3><button id="pl-invoice" class="${BTN_LIGHT}">Nouvelle facture</button></div>
      ${invs.length ? `<div class="overflow-x-auto"><table class="w-full text-sm text-left"><tbody>${invs.map((i) => `<tr class="border-b border-slate-100"><td class="py-2 pr-3 font-semibold">${escapeHtml(i.number)}</td><td class="py-2 pr-3 whitespace-nowrap">${displayDate(i.period_start)} → ${displayDate(i.period_end)}</td><td class="py-2 pr-3 whitespace-nowrap">${money(i.amount)}</td><td class="py-2 pr-3">${invoiceBadge(i)}</td><td class="py-2 text-right"><button data-inv="${escapeHtml(i.id)}" class="${BTN_LIGHT}">Voir</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="text-sm text-slate-400">Aucune facture.</p>'}</section>
    <section class="${CARD}"><h3 class="font-bold mb-1">${suspended ? 'Réactiver l’établissement' : 'Suspendre l’établissement'}</h3>
      <p class="text-sm text-slate-500 mb-3">${suspended ? 'Les utilisateurs pourront de nouveau se connecter.' : 'Révocation sans suppression : l’accès est coupé immédiatement, toutes les données sont conservées.'}</p>
      <button id="pl-suspend" class="${BTN} ${suspended ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'} text-white">${suspended ? 'Réactiver' : 'Suspendre'}</button></section>`;
  const tid = encodeURIComponent(id);
  setupIdentitySection(`/api/platform/tenants/${tid}/identity`).catch((e) => toast(e.message, 'err'));
  setupBannerSection(`/api/platform/tenants/${tid}/banner`).catch((e) => toast(e.message, 'err'));
  const reload = () => openPlatform('platform-tenants', { tenantId: id });
  $('pl-back').addEventListener('click', () => openPlatform('platform-tenants'));
  $('pl-edit').addEventListener('click', async () => {
    if (await formModal({ title: 'Identité et contact', values: t, fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'city', label: 'Ville' }, { name: 'contact_name', label: 'Contact (nom)' }, { name: 'contact_email', label: 'Contact (e-mail)', type: 'email' }, { name: 'contact_phone', label: 'Contact (téléphone)' }, { name: 'contract_ref', label: 'Référence du contrat' }, { name: 'notes', label: 'Notes internes', type: 'textarea' }],
      onSubmit: (v) => api('PUT', `/api/platform/tenants/${encodeURIComponent(id)}`, v) })) { toast('Établissement mis à jour.'); reload(); }
  });
  $('pl-license').addEventListener('click', async () => {
    const options = await planOptions(false);
    if (await formModal({ title: 'Pack, licence et quotas', values: t, fields: [{ name: 'plan_id', label: 'Pack', type: 'select', options }, { name: 'license_start', label: 'Début de licence', type: 'date' }, { name: 'license_end', label: 'Fin de licence (vide = sans fin)', type: 'date' }, { name: 'max_students', label: 'Quota d’élèves (vide = illimité)', type: 'number' }, { name: 'max_users', label: 'Quota d’utilisateurs (vide = illimité)', type: 'number' }],
      onSubmit: (v) => api('PUT', `/api/platform/tenants/${encodeURIComponent(id)}`, v) })) { toast('Licence mise à jour.'); reload(); }
  });
  $('pl-plan').addEventListener('click', async () => {
    const options = await planOptions();
    if (await formModal({ title: 'Appliquer un pack', submit: 'Appliquer', fields: [{ name: 'plan_id', label: 'Pack (ses quotas remplacent ceux de l’établissement)', type: 'select', required: true, options }],
      onSubmit: (v) => api('POST', `/api/platform/tenants/${encodeURIComponent(id)}/apply-plan`, v) })) { toast('Pack appliqué.'); reload(); }
  });
  moduleView.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('POST', `/api/platform/tenants/${encodeURIComponent(id)}/renew`, { months: Number(b.dataset.renew) }); toast('Licence renouvelée.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }));
  moduleView.querySelectorAll('[data-pwd]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Réinitialiser le mot de passe', `Un nouveau mot de passe temporaire sera généré pour ${b.dataset.who}. L’ancien cessera de fonctionner.`, false))) return;
    try { const r = (await api('PUT', `/api/platform/tenants/${encodeURIComponent(id)}/admins/${encodeURIComponent(b.dataset.pwd)}/password`, {})).data; await showTempPassword('Mot de passe réinitialisé', b.dataset.who, r.temporary_password); } catch (e) { toast(e.message, 'err'); }
  }));
  moduleView.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PUT', `/api/platform/tenants/${encodeURIComponent(id)}/admins/${encodeURIComponent(b.dataset.toggle)}/active`, { is_active: b.dataset.active !== '1' }); toast('Compte mis à jour.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('pl-invoice').addEventListener('click', async () => { const inv = await newInvoiceForm(id); if (inv) { toast('Facture créée.'); invoiceView(inv.id, 'platform-tenants'); } });
  moduleView.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => invoiceView(b.dataset.inv, 'platform-tenants')));
  $('pl-suspend').addEventListener('click', async () => {
    try {
      if (suspended) { await api('POST', `/api/platform/tenants/${encodeURIComponent(id)}/reactivate`, {}); toast('Établissement réactivé.'); return reload(); }
      if (await formModal({ title: 'Suspendre l’établissement', submit: 'Suspendre', fields: [{ name: 'reason', label: 'Motif (affiché ici uniquement)' }], onSubmit: (v) => api('POST', `/api/platform/tenants/${encodeURIComponent(id)}/suspend`, v) })) { toast('Établissement suspendu.'); reload(); }
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function platformPlans() {
  const list = rows(await get('/api/platform/plans'));
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Packs et quotas', `<button id="plan-add" class="${BTN_PRIMARY}"><i class="fa-solid fa-plus mr-2"></i>Nouveau pack</button>`)}
    <section class="${CARD}"><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Pack</th><th class="py-2 pr-3">Élèves max.</th><th class="py-2 pr-3">Utilisateurs max.</th><th class="py-2 pr-3">Prix / mois</th><th class="py-2 pr-3">Établissements</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody>
    ${list.map((p) => `<tr class="border-b border-slate-100"><td class="py-3 pr-3"><div class="font-semibold">${escapeHtml(p.name)}</div><div class="text-xs text-slate-500">${escapeHtml(p.code)}${p.description ? ` · ${escapeHtml(p.description)}` : ''}</div></td><td class="py-3 pr-3">${p.max_students === null ? '∞' : fmtNumber(p.max_students)}</td><td class="py-3 pr-3">${p.max_users === null ? '∞' : fmtNumber(p.max_users)}</td><td class="py-3 pr-3">${p.price_monthly === null ? '—' : money(p.price_monthly)}</td><td class="py-3 pr-3">${fmtNumber(p.tenants_count)}</td><td class="py-3 pr-3">${p.is_active ? 'Actif' : '<span class="text-slate-400">Désactivé</span>'}</td>
      <td class="py-3 text-right whitespace-nowrap"><button data-edit="${escapeHtml(p.id)}" class="${BTN_LIGHT}">Modifier</button> <button data-flip="${escapeHtml(p.id)}" data-active="${p.is_active ? '1' : '0'}" class="${BTN_LIGHT}">${p.is_active ? 'Désactiver' : 'Activer'}</button></td></tr>`).join('')}</tbody></table></div>
    <p class="mt-3 text-xs text-slate-400">Modifier un pack ne change pas les quotas des établissements déjà abonnés : utilisez « Appliquer un pack » sur la fiche de l’établissement. Un pack se désactive, il ne se supprime pas.</p></section>`;
  const fields = (creating) => [{ name: 'code', label: 'Code', required: creating }, { name: 'name', label: 'Nom', required: true }, { name: 'description', label: 'Description' }, { name: 'max_students', label: 'Élèves max. (vide = illimité)', type: 'number' }, { name: 'max_users', label: 'Utilisateurs max. (vide = illimité)', type: 'number' }, { name: 'price_monthly', label: 'Prix mensuel (F CFA)', type: 'number' }];
  $('plan-add').addEventListener('click', async () => { if (await formModal({ title: 'Nouveau pack', fields: fields(true), onSubmit: (v) => api('POST', '/api/platform/plans', v) })) { toast('Pack créé.'); platformPlans(); } });
  moduleView.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const p = list.find((x) => x.id === b.dataset.edit);
    if (await formModal({ title: 'Modifier le pack', values: p, fields: fields(false).filter((f) => f.name !== 'code'), onSubmit: (v) => api('PUT', `/api/platform/plans/${encodeURIComponent(p.id)}`, v) })) { toast('Pack mis à jour.'); platformPlans(); }
  }));
  moduleView.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PUT', `/api/platform/plans/${encodeURIComponent(b.dataset.flip)}`, { is_active: b.dataset.active !== '1' }); platformPlans(); } catch (e) { toast(e.message, 'err'); }
  }));
}

async function platformAudit() {
  const list = rows(await get('/api/platform/audit?limit=100'));
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Journal d’activité')}<section class="${CARD}"><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Date</th><th class="py-2 pr-3">Action</th><th class="py-2 pr-3">Établissement</th><th class="py-2">Auteur</th></tr></thead><tbody>
    ${list.length ? list.map((a) => `<tr class="border-b border-slate-100"><td class="py-2 pr-3 text-slate-500 whitespace-nowrap">${new Date(a.created_at).toLocaleString('fr-FR')}</td><td class="py-2 pr-3">${escapeHtml(PLATFORM_ACTIONS[a.action] || 'Action enregistrée')}</td><td class="py-2 pr-3">${escapeHtml(a.tenant_name || (a.details && a.details.name) || '—')}</td><td class="py-2">${escapeHtml(a.user_name || '—')}</td></tr>`).join('') : '<tr><td colspan="4" class="py-3 text-slate-400">Aucune action.</td></tr>'}</tbody></table></div></section>`;
}

function platformAccount() {
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Mon compte')}<section class="${CARD}"><p class="text-sm text-slate-500">${escapeHtml(session.user.email)} · ${escapeHtml(ROLE_LABELS[session.user.role])}</p>
    <button id="pwd-btn" class="mt-3 ${BTN_LIGHT}">Changer mon mot de passe</button></section>`;
  $('pwd-btn').addEventListener('click', async () => {
    const ok = await formModal({ title: 'Changer mon mot de passe', fields: [{ name: 'current_password', label: 'Mot de passe actuel', type: 'password', required: true }, { name: 'new_password', label: 'Nouveau mot de passe (8 caractères minimum)', type: 'password', required: true }],
      onSubmit: (v) => api('PUT', '/api/auth/password', v) });
    if (ok) toast('Mot de passe modifié.');
  });
}

// Le superadmin ne voit que le menu « Plateforme » ; les autres rôles ne le voient jamais.
function applyRoleNav() {
  const isSuper = session.user && session.user.role === 'superadmin';
  const isParent = session.user && session.user.role === 'parent';
  document.querySelectorAll('nav [data-module]').forEach((a) => {
    const k = a.dataset.module, platform = k.startsWith('platform-');
    a.classList.toggle('hidden', isSuper ? !platform : isParent ? k !== 'portal' : (platform || k === 'portal'));
  });
  if (!isSuper && !isParent) document.querySelectorAll('nav [data-module]').forEach((a) => { const k = a.dataset.module; if (['dashboard', 'settings'].includes(k) || k.startsWith('platform-')) return; if (permOf(k === 'broadcasts' ? 'notifications' : k) === 'none') a.classList.add('hidden'); });
  syncNavGroups();
  $('nav-platform-title').classList.toggle('hidden', !isSuper);
  $('search-box').classList.toggle('hidden', !!isSuper || !!isParent);
}

// ---------------------------------------------------------------- Identité (nom, slogan, logo)
const DEFAULT_APP_NAME = 'SCHOOL MANAGER PRO';
let brandBlobUrl = null;
let lastBannerMeta = null;

function applyBrand(eff, logoSrc) {
  const name = (eff && eff.app_name) || DEFAULT_APP_NAME;
  const slogan = (eff && eff.slogan) || '';
  const isDefault = name === DEFAULT_APP_NAME && !slogan;
  $('brand-default').classList.toggle('hidden', !isDefault);
  $('brand-custom').classList.toggle('hidden', isDefault);
  $('brand-name').textContent = name;
  $('brand-slogan').textContent = slogan;
  $('brand-slogan').classList.toggle('hidden', !slogan);
  for (const [img, icon] of [['brand-logo-img', 'brand-icon'], ['login-logo-img', 'login-icon']]) {
    $(img).classList.toggle('hidden', !logoSrc);
    $(icon).style.display = logoSrc ? 'none' : ''; // FontAwesome impose son propre display : la classe hidden ne suffit pas
    if (logoSrc) $(img).src = logoSrc; else $(img).removeAttribute('src');
  }
  $('login-brand-name').textContent = name;
  $('login-brand-slogan').textContent = slogan;
  $('login-brand-slogan').classList.toggle('hidden', !slogan);
  $('footer-brand').textContent = name;
  document.title = `${name} - Tableau de bord`;
  HERO_DEFAULT.title = `Bienvenue sur <span class="text-amber-300">${escapeHtml(name)} !</span>`;
  applyBannerMeta(lastBannerMeta);
}

// Page de connexion : identité de la plateforme (publique, aucune donnée d'établissement).
async function loadPublicIdentity() {
  try {
    const res = await fetch('/api/identity');
    if (!res.ok) return;
    const d = (await res.json()).data;
    applyBrand(d, d.has_logo ? `/api/identity/logo?v=${encodeURIComponent(d.updated_at || '')}` : null);
  } catch (e) { /* hors ligne : identité par défaut */ }
}

// Après connexion : identité effective (établissement > plateforme > défaut).
async function loadIdentity() {
  try {
    const base = session.user.role === 'superadmin' ? '/api/platform/identity' : '/api/settings/identity';
    const d = (await get(base)).data;
    let url = null;
    if (d.effective.has_logo) {
      const res = await fetch(`${base}/logo`, { headers: authHeaders() });
      if (res.ok) { url = URL.createObjectURL(await res.blob()); }
    }
    if (brandBlobUrl) URL.revokeObjectURL(brandBlobUrl);
    brandBlobUrl = url;
    applyBrand(d.effective, url);
    return d;
  } catch (e) { return null; }
}

function identitySectionHtml(platform) {
  return `<section id="idn-section" class="${CARD}">
    <h3 class="font-bold mb-1">Identité de l’application</h3>
    <p class="text-sm text-slate-500 mb-3">${platform ? 'Nom, slogan et logo par défaut : affichés sur la page de connexion et dans les établissements qui n’ont pas leur propre identité.' : 'Nom, slogan et logo affichés dans le menu, sur la page de connexion et sur le tableau de bord de cet établissement.'}</p>
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="rounded-xl bg-[#0b172a] p-4 flex items-center gap-3 min-h-[88px]" aria-label="Aperçu">
        <div class="w-14 h-14 shrink-0 rounded-xl bg-gradient-to-tr from-amber-400 to-amber-300 flex items-center justify-center text-[#0b172a] text-2xl overflow-hidden"><i id="idn-prev-icon" class="fa-solid fa-graduation-cap"></i><img id="idn-prev-logo" alt="" class="hidden w-full h-full object-contain bg-white"></div>
        <div class="min-w-0"><div id="idn-prev-name" class="text-white font-extrabold truncate"></div><div id="idn-prev-slogan" class="text-amber-400 text-xs truncate"></div></div>
      </div>
      <ul id="idn-reqs" class="text-xs text-slate-600 list-disc pl-5 self-center space-y-1"></ul>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input id="idn-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
      <button id="idn-pick" class="${BTN_PRIMARY}">Choisir un logo…</button>
      <button id="idn-send" class="${BTN} bg-emerald-600 hover:bg-emerald-700 text-white hidden">Publier ce logo</button>
      <button id="idn-rm-logo" class="${BTN_LIGHT} hidden">Retirer le logo</button>
    </div>
    <div id="idn-errors" class="mt-3 hidden rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3" role="alert"></div>
    <div class="mt-4 grid sm:grid-cols-2 gap-3">
      <label class="text-sm font-medium text-slate-700">Nom de l’application<input id="idn-name" maxlength="60" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="${DEFAULT_APP_NAME}"></label>
      <label class="text-sm font-medium text-slate-700">Slogan<input id="idn-slogan" maxlength="120" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Ex. L’école connectée"></label>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button id="idn-save" class="${BTN} border border-blue-600 text-blue-700 hover:bg-blue-50">Enregistrer les textes</button>
      <button id="idn-reset" class="${BTN_LIGHT}">Revenir aux valeurs par défaut</button>
    </div>
  </section>`;
}

async function setupIdentitySection(base) {
  let d = (await get(base)).data;
  const req = d.requirements;
  let pending = null; let pendingUrl = null;
  const showErrors = (list) => { const box = $('idn-errors'); box.classList.toggle('hidden', !list.length); box.innerHTML = list.length ? `<strong>Logo refusé :</strong><ul class="list-disc pl-5 mt-1">${list.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''; };
  $('idn-reqs').innerHTML = [`Image carrée (1:1), ex. 512×512 px`, `Taille : de ${req.minWidth}×${req.minHeight} à ${req.maxWidth}×${req.maxHeight} px`, 'Types : PNG, JPEG ou WebP', `Poids maximal : ${Math.round(req.maxBytes / 1024)} Ko`].map((t) => `<li>${t}</li>`).join('');
  const render = (eff, logo) => {
    $('idn-prev-name').textContent = (eff && eff.app_name) || DEFAULT_APP_NAME;
    $('idn-prev-slogan').textContent = (eff && eff.slogan) || '';
    $('idn-prev-logo').classList.toggle('hidden', !logo); $('idn-prev-icon').style.display = logo ? 'none' : '';
    if (logo) $('idn-prev-logo').src = logo; else $('idn-prev-logo').removeAttribute('src');
  };
  let previewUrl = null;
  const refresh = async () => {
    d = (await get(base)).data;
    if (!base.includes('/api/platform/tenants/')) await loadIdentity();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (d.effective.has_logo) { const res = await fetch(`${base}/logo`, { headers: authHeaders() }); if (res.ok) previewUrl = URL.createObjectURL(await res.blob()); }
    render(d.effective, previewUrl);
    $('idn-name').value = d.custom.app_name || ''; $('idn-slogan').value = d.custom.slogan || '';
    $('idn-rm-logo').classList.toggle('hidden', !d.custom.has_logo);
    $('idn-reset').classList.toggle('hidden', !(d.custom.app_name || d.custom.slogan || d.custom.has_logo));
  };
  await refresh();
  $('idn-pick').addEventListener('click', () => $('idn-file').click());
  $('idn-file').addEventListener('change', async () => {
    const file = $('idn-file').files[0];
    pending = null; $('idn-send').classList.add('hidden'); showErrors([]);
    if (!file) return;
    const r = await checkImageFile(file, req, 'le logo');
    if (r.errors.length) { showErrors(r.errors); $('idn-file').value = ''; return; }
    pending = file;
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pendingUrl = URL.createObjectURL(file);
    render({ app_name: $('idn-name').value.trim() || d.effective.app_name, slogan: $('idn-slogan').value.trim() }, pendingUrl);
    $('idn-send').classList.remove('hidden');
  });
  $('idn-send').addEventListener('click', async () => {
    if (!pending) return;
    $('idn-send').disabled = true;
    try {
      const res = await fetch(`${base}/logo`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': pending.type }, body: pending });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showErrors(Array.isArray(data.errors) && data.errors.length ? data.errors : [data.error || `Erreur HTTP ${res.status}`]); return; }
      pending = null; $('idn-file').value = ''; $('idn-send').classList.add('hidden');
      await refresh(); toast('Logo publié.');
    } catch (e) { showErrors(['Serveur injoignable. Vérifiez votre connexion.']); } finally { $('idn-send').disabled = false; }
  });
  $('idn-rm-logo').addEventListener('click', async () => { try { await api('DELETE', `${base}/logo`); await refresh(); toast('Logo retiré.'); } catch (e) { toast(e.message, 'err'); } });
  $('idn-save').addEventListener('click', async () => {
    try { await api('PUT', `${base}/text`, { app_name: $('idn-name').value.trim(), slogan: $('idn-slogan').value.trim() }); await refresh(); toast('Textes enregistrés.'); } catch (e) { toast(e.message, 'err'); }
  });
  $('idn-reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Valeurs par défaut', 'Le nom, le slogan et le logo personnalisés seront supprimés.'))) return;
    try { await api('DELETE', base); showErrors([]); await refresh(); toast('Identité par défaut rétablie.'); } catch (e) { toast(e.message, 'err'); }
  });
}

// ---------------------------------------------------------------- Mon abonnement (administrateur d'établissement)
const INVOICE_BADGES = { paid: ['Payée', 'bg-emerald-50 text-emerald-700'], pending: ['En attente', 'bg-amber-50 text-amber-700'], overdue: ['En retard', 'bg-red-50 text-red-700'], cancelled: ['Annulée', 'bg-slate-100 text-slate-500'], issued: ['Émis', 'bg-indigo-50 text-indigo-700'] };
const invoiceBadge = (i) => { const b = INVOICE_BADGES[i.overdue ? 'overdue' : i.status]; return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${b[1]}">${b[0]}</span>`; };
const PAY_METHODS = [['especes', 'Espèces'], ['virement', 'Virement'], ['orange_money', 'Orange Money'], ['moov_money', 'Moov Money'], ['cheque', 'Chèque'], ['autre', 'Autre']];
const payMethodLabel = (m) => (PAY_METHODS.find((x) => x[0] === m) || [m, m || '—'])[1];

function subscriptionSectionHtml() {
  return `<section id="sub-section" class="${CARD}"><h3 class="font-bold mb-3">Mon abonnement</h3><div id="sub-body" class="text-sm text-slate-500">Chargement…</div></section>`;
}
async function setupSubscription() {
  const d = (await get('/api/settings/subscription')).data;
  const line = (k, v) => `<div class="flex justify-between gap-4 py-1.5 border-b border-slate-100"><span class="text-slate-500">${k}</span><span class="font-medium text-slate-800 text-right">${v}</span></div>`;
  $('sub-body').innerHTML = `<div class="grid lg:grid-cols-2 gap-x-8">
      <div>${line('Pack', escapeHtml(d.plan_name || 'Aucun'))}${line('Licence', licenseBadge(d.license_state))}${line('Validité', d.license_end ? `jusqu’au ${displayDate(d.license_end)}` : 'sans date de fin')}</div>
      <div>${line('Élèves', quotaText(d.students_count, d.max_students))}${line('Utilisateurs', quotaText(d.users_count, d.max_users))}</div></div>
    <h4 class="font-semibold text-slate-700 mt-4 mb-2">Factures</h4>
    ${d.invoices.length ? `<div class="overflow-x-auto"><table class="w-full text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Numéro</th><th class="py-2 pr-3">Période</th><th class="py-2 pr-3">Montant</th><th class="py-2 pr-3">Échéance</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody>
      ${d.invoices.map((i) => { const credit = i.document_type === 'credit_note'; return `<tr class="border-b border-slate-100"><td class="py-2 pr-3 font-medium text-slate-800">${escapeHtml(i.number)}${credit ? ' <span class="text-xs text-slate-400">(avoir)</span>' : ''}</td><td class="py-2 pr-3">${i.period_start ? `${displayDate(i.period_start)} → ${displayDate(i.period_end)}` : '—'}</td><td class="py-2 pr-3 whitespace-nowrap">${credit ? '− ' : ''}${money(i.amount)}${i.tax_amount ? `<div class="text-xs text-slate-400">dont TVA ${money(i.tax_amount)}</div>` : ''}</td><td class="py-2 pr-3">${i.due_date ? displayDate(i.due_date) : '—'}</td><td class="py-2 pr-3">${invoiceBadge(i)}</td><td class="py-2 text-right">${!credit && i.status === 'pending' ? '<button type="button" disabled title="Indisponible pour le moment" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"><i class="fa-solid fa-ban mr-1"></i>Payer en ligne</button>' : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="text-slate-400">Aucune facture.</p>'}
    <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" id="online-pay-note"><i class="fa-solid fa-circle-info mr-1"></i><strong>Paiement en ligne (Orange Money, Moov Money) : indisponible pour le moment.</strong> Réglez auprès de l’éditeur (espèces, virement, Orange Money ou Moov Money en direct, chèque).</div>
    <p class="mt-3 text-xs text-slate-400">Pour renouveler ou changer de pack, contactez l’éditeur du logiciel.</p>`;
}

// ---------------------------------------------------------------- Facturation des abonnements (superadmin)
async function downloadFile(url, filename) {
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
  } catch (e) { toast(e.message, 'err'); }
}

async function newInvoiceForm(tenantId) {
  let tId = tenantId;
  const fields = [];
  if (!tId) {
    const list = rows(await get('/api/platform/tenants?limit=100'));
    fields.push({ name: 'tenant_id', label: 'Établissement', type: 'select', required: true, options: list.map((t) => [t.id, `${t.name} (${t.code})`]) });
  }
  fields.push({ name: 'months', label: 'Durée (mois)', type: 'number', required: true }, { name: 'amount', label: 'Montant HT en F CFA (vide = prix du pack × durée)', type: 'number' },
    { name: 'discount_percent', label: 'Remise en % (facultatif)', type: 'number' }, { name: 'tax_rate', label: 'TVA en % (vide = taux des réglages)', type: 'number' },
    { name: 'description', label: 'Description (facultatif)' }, { name: 'due_date', label: 'Échéance (vide = 15 jours)', type: 'date' }, { name: 'notes', label: 'Notes (facultatif)' });
  let created = null;
  const ok = await formModal({ title: 'Nouvelle facture d’abonnement', submit: 'Créer la facture', values: { months: 12 }, fields,
    onSubmit: async (v) => { const { tenant_id: tid, ...body } = v; created = (await api('POST', `/api/platform/tenants/${encodeURIComponent(tenantId || tid)}/invoices`, body)).data; } });
  return ok ? created : null;
}

async function payInvoiceForm(inv) {
  return formModal({ title: `Encaisser ${inv.number}`, submit: 'Enregistrer le paiement', values: { payment_method: 'especes', extend_license: 'true', paid_at: new Date().toISOString().slice(0, 10) },
    fields: [{ name: 'payment_method', label: `Mode de paiement — ${money(inv.amount)}`, type: 'select', required: true, options: PAY_METHODS }, { name: 'payment_ref', label: 'Référence (n° de transaction, de chèque…)' }, { name: 'paid_at', label: 'Date du paiement', type: 'date' },
      { name: 'extend_license', label: 'Licence', type: 'select', options: [['true', `Prolonger jusqu’au ${displayDate(inv.period_end)}`], ['false', 'Ne pas modifier la licence']] }],
    onSubmit: (v) => api('POST', `/api/platform/invoices/${encodeURIComponent(inv.id)}/pay`, { ...v, extend_license: v.extend_license !== 'false' }) });
}

async function billingSettingsForm() {
  const c = (await get('/api/platform/billing-settings')).data;
  return formModal({ title: 'Réglages de facturation', submit: 'Enregistrer',
    values: { tax_rate: c.tax_rate, legal_details: c.legal_details, payment_instructions: c.payment_instructions },
    fields: [{ name: 'tax_rate', label: 'TVA par défaut en % (0 = non applicable)', type: 'number' }, { name: 'legal_details', label: 'Mentions légales (NIF, RCCM, adresse…)', type: 'textarea' }, { name: 'payment_instructions', label: 'Modalités de paiement (RIB, numéros Orange / Moov Money…)', type: 'textarea' }],
    onSubmit: (v) => api('PUT', '/api/platform/billing-settings', { tax_rate: v.tax_rate === undefined ? 0 : v.tax_rate, legal_details: v.legal_details || '', payment_instructions: v.payment_instructions || '' }) })
    .then((ok) => { if (ok) toast('Réglages enregistrés.'); return ok; });
}

async function creditNoteForm(inv) {
  const left = Number(inv.amount) - Number(inv.credited || 0);
  return formModal({ title: `Avoir sur ${inv.number}`, submit: 'Émettre l’avoir', values: { amount: left },
    fields: [{ name: 'amount', label: `Montant TTC de l’avoir (maximum ${money(left)})`, type: 'number', required: true }, { name: 'reason', label: 'Motif', required: true }],
    onSubmit: (v) => api('POST', `/api/platform/invoices/${encodeURIComponent(inv.id)}/credit-note`, v) });
}

async function sendInvoiceByMail(inv) {
  try {
    const r = await api('POST', `/api/platform/invoices/${encodeURIComponent(inv.id)}/send`, {});
    toast(`Envoyée à ${r.data.to.join(', ')}.`);
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

const billingFilter = { status: '', type: '', from: '', to: '' };
async function platformBilling() {
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Facturation des abonnements', `<button id="bl-csv" class="${BTN_LIGHT}"><i class="fa-solid fa-file-csv mr-2"></i>Exporter (CSV)</button><button id="bl-settings" class="${BTN_LIGHT}"><i class="fa-solid fa-gear mr-2"></i>Réglages</button><button id="bl-new" class="${BTN_PRIMARY}"><i class="fa-solid fa-plus mr-2"></i>Nouvelle facture</button>`)}
    <div id="bl-kpis" class="grid sm:grid-cols-3 gap-3"></div>
    <section class="${CARD}"><div class="flex flex-wrap gap-2 mb-4 items-end">
      <select id="bl-status" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Statut"><option value="">Toutes</option><option value="pending">En attente</option><option value="overdue">En retard</option><option value="paid">Payées</option><option value="cancelled">Annulées</option></select>
      <select id="bl-type" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Type"><option value="">Factures et avoirs</option><option value="invoice">Factures</option><option value="credit_note">Avoirs</option></select>
      <label class="text-xs text-slate-500">Du <input id="bl-from" type="date" class="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value="${billingFilter.from}"></label>
      <label class="text-xs text-slate-500">au <input id="bl-to" type="date" class="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value="${billingFilter.to}"></label></div>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Numéro</th><th class="py-2 pr-3">Établissement</th><th class="py-2 pr-3">Période</th><th class="py-2 pr-3">Montant</th><th class="py-2 pr-3">Échéance</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody id="bl-rows"></tbody></table></div></section>`;
  $('bl-status').value = billingFilter.status; $('bl-type').value = billingFilter.type;
  const qs = () => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(billingFilter)) if (v) q.set(k, v); return q; };
  async function load() {
    const q = qs(); q.set('limit', '100');
    const r = await get(`/api/platform/invoices?${q}`);
    const m = r.meta;
    $('bl-kpis').innerHTML = [['Encaissé', m.paid_total, 'text-emerald-700'], ['En attente', m.pending_total, 'text-amber-700'], ['Dont en retard', m.overdue_total, 'text-red-700']]
      .map(([t, v, c]) => `<div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm"><div class="text-xs font-medium text-slate-500">${t}</div><div class="text-2xl font-bold ${c}">${money(v)}</div></div>`).join('');
    $('bl-rows').innerHTML = r.data.length ? r.data.map((i) => `<tr class="border-b border-slate-100"><td class="py-2.5 pr-3 font-semibold">${escapeHtml(i.number)}${i.document_type === 'credit_note' ? ' <span class="text-xs font-normal text-slate-400">avoir</span>' : ''}</td><td class="py-2.5 pr-3">${escapeHtml(i.tenant_name)}</td><td class="py-2.5 pr-3 whitespace-nowrap">${displayDate(i.period_start)} → ${displayDate(i.period_end)}</td><td class="py-2.5 pr-3 whitespace-nowrap">${i.document_type === 'credit_note' ? '− ' : ''}${money(i.amount)}</td><td class="py-2.5 pr-3">${i.due_date ? displayDate(i.due_date) : '—'}</td><td class="py-2.5 pr-3">${invoiceBadge(i)}</td>
      <td class="py-2.5 text-right whitespace-nowrap"><button data-view="${escapeHtml(i.id)}" class="${BTN_LIGHT}">Voir</button>${i.document_type === 'invoice' && i.status === 'pending' ? ` <button data-pay="${escapeHtml(i.id)}" class="${BTN} bg-emerald-600 hover:bg-emerald-700 text-white">Encaisser</button> <button data-cancel="${escapeHtml(i.id)}" class="${BTN_LIGHT}">Annuler</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="py-4 text-slate-400">Aucune facture.</td></tr>';
    bills = r.data;
  }
  let bills = [];
  const guard = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, 'err'); } };
  $('bl-status').addEventListener('change', (e) => { billingFilter.status = e.target.value; guard(load)(); });
  $('bl-type').addEventListener('change', (e) => { billingFilter.type = e.target.value; guard(load)(); });
  $('bl-from').addEventListener('change', (e) => { billingFilter.from = e.target.value; guard(load)(); });
  $('bl-to').addEventListener('change', (e) => { billingFilter.to = e.target.value; guard(load)(); });
  $('bl-csv').addEventListener('click', () => downloadFile(`/api/platform/invoices.csv?${qs()}`, 'factures-abonnements.csv'));
  $('bl-settings').addEventListener('click', () => billingSettingsForm());
  $('bl-new').addEventListener('click', async () => { const inv = await newInvoiceForm(); if (inv) { toast('Facture créée.'); invoiceView(inv.id, 'platform-billing'); } });
  $('bl-rows').addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]'); const p = e.target.closest('[data-pay]'); const c = e.target.closest('[data-cancel]');
    try {
      if (v) return invoiceView(v.dataset.view, 'platform-billing');
      if (p) { const inv = bills.find((x) => x.id === p.dataset.pay); if (await payInvoiceForm(inv)) { toast('Paiement enregistré.'); await load(); } return; }
      if (c) { if (await confirmDialog('Annuler la facture', 'Une facture annulée ne peut plus être encaissée.', false)) { await api('POST', `/api/platform/invoices/${encodeURIComponent(c.dataset.cancel)}/cancel`, {}); toast('Facture annulée.'); await load(); } }
    } catch (x) { toast(x.message, 'err'); }
  });
  await load();
}

async function invoiceView(id, back) {
  const i = (await get(`/api/platform/invoices/${encodeURIComponent(id)}`)).data;
  const iss = i.issuer; const t = i.tenant || {};
  moduleView.innerHTML = `<div class="no-print flex justify-between"><button id="iv-back" class="${BTN_LIGHT}"><i class="fa-solid fa-arrow-left mr-2"></i>Retour</button>
      <div class="flex flex-wrap gap-2">${i.document_type === 'invoice' && i.status === 'pending' ? `<button id="iv-pay" class="${BTN} bg-emerald-600 hover:bg-emerald-700 text-white">Encaisser</button>` : ''}${i.document_type === 'invoice' && i.status !== 'cancelled' && Number(i.credited || 0) < Number(i.amount) ? `<button id="iv-credit" class="${BTN_LIGHT}">Émettre un avoir</button>` : ''}<button id="iv-send" class="${BTN_LIGHT}"><i class="fa-solid fa-envelope mr-2"></i>Envoyer par e-mail</button><button id="iv-print" class="${BTN_PRIMARY}"><i class="fa-solid fa-print mr-2"></i>Imprimer</button><button id="iv-pdf" class="${BTN_LIGHT}"><i class="fa-solid fa-file-pdf mr-2"></i>PDF</button></div></div>
    <article id="invoice-doc" class="${CARD} max-w-3xl mx-auto w-full p-8 print:border-0">
      <header class="flex justify-between items-start gap-4 border-b border-slate-200 pb-5">
        <div class="flex items-center gap-3">${iss.has_logo ? '<img src="/api/identity/logo" alt="" class="w-14 h-14 object-contain">' : ''}<div><div class="text-xl font-extrabold text-slate-900">${escapeHtml(iss.app_name)}</div>${iss.slogan ? `<div class="text-xs text-slate-500">${escapeHtml(iss.slogan)}</div>` : ''}</div></div>
        <div class="text-right"><div class="text-2xl font-bold text-slate-900">${i.document_type === 'credit_note' ? 'AVOIR' : 'FACTURE'}</div>${i.credit_for_number ? `<div class="text-xs text-slate-500">sur facture ${escapeHtml(i.credit_for_number)}</div>` : ''}<div class="font-semibold">${escapeHtml(i.number)}</div><div class="mt-1">${invoiceBadge(i)}</div></div></header>
      <section class="grid sm:grid-cols-2 gap-6 py-5 text-sm">
        <div><div class="text-xs uppercase tracking-wide text-slate-400 mb-1">Facturé à</div><div class="font-semibold text-slate-900">${escapeHtml(i.tenant_name)}</div><div class="text-slate-600">${[t.city, t.contact_name, t.contact_email, t.contact_phone].filter(Boolean).map(escapeHtml).join('<br>')}</div></div>
        <div class="sm:text-right text-slate-600"><div>Date d’émission : <strong>${displayDate(i.created_at)}</strong></div><div>Échéance : <strong>${displayDate(i.due_date)}</strong></div>${t.contract_ref ? `<div>Contrat : <strong>${escapeHtml(t.contract_ref)}</strong></div>` : ''}</div></section>
      <table class="w-full text-sm"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 text-left">Description</th><th class="py-2 text-left">Période</th><th class="py-2 text-right">Montant</th></tr></thead>
        <tbody><tr class="border-b border-slate-100"><td class="py-3">${escapeHtml(i.description)}</td><td class="py-3 whitespace-nowrap">${displayDate(i.period_start)} → ${displayDate(i.period_end)}</td><td class="py-3 text-right whitespace-nowrap">${money(i.amount)}</td></tr></tbody>
        <tfoot>${i.document_type === 'credit_note' ? '' : `${Number(i.discount_amount) || Number(i.tax_amount) ? `<tr><td colspan="2" class="pt-3 text-right text-slate-500">Sous-total HT</td><td class="pt-3 text-right whitespace-nowrap">${money(i.subtotal)}</td></tr>` : ''}${Number(i.discount_amount) ? `<tr><td colspan="2" class="text-right text-slate-500">Remise</td><td class="text-right whitespace-nowrap">− ${money(i.discount_amount)}</td></tr>` : ''}${Number(i.tax_amount) ? `<tr><td colspan="2" class="text-right text-slate-500">TVA ${fmtNumber(i.tax_rate)} %</td><td class="text-right whitespace-nowrap">${money(i.tax_amount)}</td></tr>` : ''}`}
          <tr><td colspan="2" class="pt-4 text-right font-semibold">${i.document_type === 'credit_note' ? 'Total de l’avoir' : 'Total TTC'}</td><td class="pt-4 text-right text-lg font-bold text-slate-900 whitespace-nowrap">${i.document_type === 'credit_note' ? '− ' : ''}${money(i.amount)}</td></tr>
          ${Number(i.credited) > 0 ? `<tr><td colspan="2" class="text-right text-slate-500">Avoirs émis</td><td class="text-right whitespace-nowrap">− ${money(i.credited)}</td></tr><tr><td colspan="2" class="text-right font-semibold">Net à payer</td><td class="text-right font-bold whitespace-nowrap">${money(Number(i.amount) - Number(i.credited))}</td></tr>` : ''}</tfoot></table>
      ${i.status === 'paid' ? `<p class="mt-5 text-sm text-emerald-700">Payée le ${displayDate(i.paid_at)} — ${escapeHtml(payMethodLabel(i.payment_method))}${i.payment_ref ? ` (réf. ${escapeHtml(i.payment_ref)})` : ''}.</p>` : ''}
      ${i.status === 'cancelled' ? '<p class="mt-5 text-sm text-slate-500">Facture annulée.</p>' : ''}
      ${i.notes ? `<p class="mt-3 text-xs text-slate-500">${escapeHtml(i.notes)}</p>` : ''}
      ${i.document_type === 'invoice' && iss.payment_instructions ? `<div class="mt-5 text-sm"><div class="text-xs uppercase tracking-wide text-slate-400 mb-1">Modalités de paiement</div><p class="text-slate-700 whitespace-pre-line">${escapeHtml(iss.payment_instructions)}</p></div>` : ''}
      ${iss.legal_details ? `<p class="mt-5 pt-3 border-t border-slate-100 text-xs text-slate-400 whitespace-pre-line">${escapeHtml(iss.legal_details)}</p>` : ''}
    </article>`;
  $('iv-back').addEventListener('click', () => openPlatform(back || 'platform-billing'));
  $('iv-print').addEventListener('click', () => window.print());
  $('iv-pdf').addEventListener('click', async () => { try { await downloadFile(`/api/platform/invoices/${encodeURIComponent(id)}/pdf`, `${i.document_type === 'credit_note' ? 'avoir' : 'facture'}-${i.number}.pdf`); } catch (e) { toast(e.message, 'err'); } });
  if ($('iv-credit')) $('iv-credit').addEventListener('click', async () => { if (await creditNoteForm(i)) { toast('Avoir émis.'); invoiceView(id, back); } });
  $('iv-send').addEventListener('click', async () => { if (await sendInvoiceByMail(i)) invoiceView(id, back); });
  if ($('iv-pay')) $('iv-pay').addEventListener('click', async () => { if (await payInvoiceForm(i)) { toast('Paiement enregistré.'); invoiceView(id, back); } });
}

const MAIL_STATUS = { sent: ['Envoyé', 'bg-emerald-50 text-emerald-700'], failed: ['Échec', 'bg-red-50 text-red-700'], skipped: ['Non envoyé', 'bg-slate-100 text-slate-500'], queued: ['En attente', 'bg-amber-50 text-amber-700'] };
const MAIL_KINDS = { test: 'Test', invoice: 'Facture', password_reset: 'Mot de passe', reminder_license: 'Rappel licence', reminder_invoice: 'Rappel facture', other: 'Autre' };
async function platformMail() {
  moduleView.innerHTML = `${platformTitle('Plateforme', 'E-mails et rappels')}<div id="ml-top"></div>
    <section class="${CARD}"><div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 class="font-bold">Journal des envois</h3>
      <select id="ml-status" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Statut"><option value="">Tous</option><option value="sent">Envoyés</option><option value="failed">En échec</option><option value="skipped">Non envoyés</option></select></div>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-xs text-slate-500 border-b"><th class="py-2 pr-3">Date</th><th class="py-2 pr-3">Destinataire</th><th class="py-2 pr-3">Objet</th><th class="py-2 pr-3">Type</th><th class="py-2 pr-3">Statut</th><th class="py-2"></th></tr></thead><tbody id="ml-rows"></tbody></table></div></section>`;
  const guard = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, 'err'); } };
  async function loadTop() {
    const c = (await get('/api/platform/mail')).data;
    $('ml-top').innerHTML = `<section class="${CARD}"><div class="flex flex-wrap items-start justify-between gap-3"><div>
        <div class="flex items-center gap-2"><h3 class="font-bold">Envoi d’e-mails</h3><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${c.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">${c.configured ? 'Configuré' : 'Non configuré'}</span></div>
        ${c.configured ? `<p class="text-sm text-slate-600 mt-1">Serveur ${escapeHtml(c.host)}:${c.port}${c.secure ? ' (TLS)' : ''} · expéditeur ${escapeHtml(c.from)}</p>` : `<p class="text-sm text-amber-800 mt-1">${escapeHtml(c.message)}</p>`}
        <p class="text-xs text-slate-500 mt-1">Envoyés : ${fmtNumber(c.stats.sent)} · échecs : ${fmtNumber(c.stats.failed)} · non envoyés : ${fmtNumber(c.stats.skipped)} · rappels déjà envoyés : ${fmtNumber(c.reminders_sent)} · planificateur : ${c.scheduler ? 'actif (toutes les 6 h)' : 'désactivé'}</p></div>
        <div class="flex flex-wrap gap-2"><button id="ml-test" class="${BTN_LIGHT}">Envoyer un test</button><button id="ml-dry" class="${BTN_LIGHT}">Simuler les rappels</button><button id="ml-run" class="${BTN_PRIMARY}">Envoyer les rappels maintenant</button></div></div>
        <div id="ml-result" class="mt-3 text-sm"></div>
        <p class="mt-3 text-xs text-slate-400">Rappels automatiques : fin de licence (30, 15, 7 jours avant, jour J et après expiration) et factures impayées (3, 10 et 17 jours de retard). Chaque rappel n’est envoyé qu’une fois.</p></section>`;
    $('ml-test').addEventListener('click', async () => {
      const ok = await formModal({ title: 'Envoyer un e-mail de test', submit: 'Envoyer', fields: [{ name: 'to', label: 'Adresse du destinataire', type: 'email', required: true }], onSubmit: (v) => api('POST', '/api/platform/mail/test', v) });
      if (ok) { toast('E-mail de test envoyé.'); guard(loadAll)(); }
    });
    const runReminders = (dry) => guard(async () => {
      if (!dry && !(await confirmDialog('Envoyer les rappels', 'Les rappels dus seront envoyés maintenant aux établissements concernés.', false))) return;
      const r = (await api('POST', '/api/platform/reminders/run', { dry_run: dry })).data;
      $('ml-result').innerHTML = `<div class="rounded-lg bg-slate-50 border border-slate-200 p-3"><p class="font-semibold mb-1">${dry ? 'Simulation' : 'Exécution'} : ${r.due.length} rappel(s) dû(s)${dry ? '' : ` — envoyés ${r.sent}, échecs ${r.failed}, ignorés ${r.skipped}`}</p>
        ${r.due.length ? `<ul class="list-disc ml-5 text-slate-600">${r.due.map((d) => `<li>${escapeHtml(d.label)} → ${d.to.length ? escapeHtml(d.to.join(', ')) : '<em>aucun destinataire</em>'}</li>`).join('')}</ul>` : '<p class="text-slate-500">Aucun rappel à envoyer.</p>'}
        ${!r.mail_configured && !dry ? '<p class="text-amber-800 mt-1">Rien n’a été envoyé : e-mail non configuré (les rappels partiront dès la configuration).</p>' : ''}</div>`;
      if (!dry) loadAll();
    });
    $('ml-dry').addEventListener('click', runReminders(true));
    $('ml-run').addEventListener('click', runReminders(false));
  }
  async function loadRows() {
    const st = $('ml-status').value;
    const r = await get(`/api/platform/mail/outbox?limit=50${st ? `&status=${st}` : ''}`);
    $('ml-rows').innerHTML = r.data.length ? r.data.map((m) => { const s = MAIL_STATUS[m.status] || MAIL_STATUS.queued; return `<tr class="border-b border-slate-100 align-top"><td class="py-2 pr-3 whitespace-nowrap text-slate-500">${new Date(m.created_at).toLocaleString('fr-FR')}</td><td class="py-2 pr-3">${escapeHtml(m.to_email)}${m.tenant_name ? `<div class="text-xs text-slate-400">${escapeHtml(m.tenant_name)}</div>` : ''}</td><td class="py-2 pr-3">${escapeHtml(m.subject)}${m.error ? `<div class="text-xs text-red-600">${escapeHtml(m.error)}</div>` : ''}</td><td class="py-2 pr-3">${escapeHtml(MAIL_KINDS[m.kind] || m.kind)}</td><td class="py-2 pr-3"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s[1]}">${s[0]}</span></td><td class="py-2 text-right">${m.status === 'failed' || m.status === 'skipped' ? `<button data-retry="${escapeHtml(m.id)}" class="${BTN_LIGHT}">Renvoyer</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="6" class="py-4 text-slate-400">Aucun message.</td></tr>';
  }
  async function loadAll() { await Promise.all([loadTop(), loadRows()]); }
  $('ml-status').addEventListener('change', guard(loadRows));
  $('ml-rows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-retry]'); if (!b) return;
    try { await api('POST', `/api/platform/mail/outbox/${encodeURIComponent(b.dataset.retry)}/retry`, {}); toast('Message renvoyé.'); } catch (x) { toast(x.message, 'err'); }
    guard(loadAll)();
  });
  await loadAll();
}

async function platformIdentity() {
  moduleView.innerHTML = `${platformTitle('Plateforme', 'Identité de la plateforme')}${identitySectionHtml(true)}`;
  await setupIdentitySection('/api/platform/identity');
}

// ---------------------------------------------------------------- Démarrage
function applyIdentity() {
  const u = session.user;
  $('user-name').textContent = u.full_name || u.email;
  $('user-role').textContent = ROLE_LABELS[u.role] || u.role;
}

async function startApp() {
  if (session.user && session.user.role !== 'superadmin' && !session.user.permissions) {
    try { session.user = (await get('/api/auth/me')).data; } catch (e) { /* la barre se limitera aux droits connus */ }
  }
  applyIdentity();
  applyRoleNav();
  await loadIdentity();
  if (session.user.role === 'superadmin') { setActiveNav('platform-overview'); showView(); await openPlatform('platform-overview'); return; }
  if (session.user.role === 'parent') { setActiveNav('portal'); showView(); await openPortal(); return; }
  showDashboard();
  await loadDashboard();
}

async function boot() {
  $('today-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('footer-year').textContent = new Date().getFullYear();
  loadHealth();
  loadPublicIdentity();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => { /* hors ligne non disponible */ });
  if (/^#reset=/.test(location.hash)) { session.token = null; store.del('smp.token'); showLogin(); return openResetFromLink(); }
  if (!session.token) return showLogin();
  try {
    session.user = (await get('/api/auth/me')).data;
    $('login-overlay').classList.add('hidden');
    await startApp();
  } catch (e) { if (e.status !== 401) showLogin(e.message); }
}
boot();
