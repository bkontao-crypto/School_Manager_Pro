// Permissions par module et par rôle (aucun, lecture, écriture), personnalisables par l'administrateur de chaque établissement.
//
//  - « admin » a toujours tous les droits (non configurable) : impossible de se verrouiller hors de son propre établissement ;
//  - la matrice par défaut reprend le comportement historique, sauf les modules Paiements et RH (décisions D1 et D2 de la Phase 1) ;
//  - seules les dérogations sont stockées ;
//  - « écriture » inclut « lecture » ; la lecture d'un module est exigée sur toutes ses routes GET, l'écriture sur ses actions ;
//  - les comptes, paramètres, identité et facturation de l'abonnement restent réservés à l'administrateur.

const db = require('./db');

const LEVELS = ['none', 'read', 'write'];
const RANK = { none: 0, read: 1, write: 2 };
const ROLES = ['gerant', 'teacher', 'accountant', 'staff', 'user']; // « gerant » : peut rouvrir une période ; « parent » : accès fixe au portail, hors matrice
const MESSAGE_ROLES = ROLES;

const MODULES = {
  students: 'Élèves', classes: 'Classes', teachers: 'Enseignants', timetable: 'Emploi du temps', grades: 'Notes',
  attendances: 'Présences', payments: 'Paiements', messages: 'Messages', library: 'Bibliothèque', canteen: 'Cantine',
  transport: 'Transport', hr: 'Personnel (RH)', documents: 'Documents', stocks: 'Stocks', reports: 'Rapports',
  periods: 'Périodes scolaires', notifications: 'Notifications'
};

// Écriture par défaut, par module (le reste du monde : lecture, sauf « rapports »).
const DEFAULT_WRITE = {
  attendances: ['teacher'], documents: ['teacher'], grades: ['teacher'], payments: ['accountant'],
  messages: MESSAGE_ROLES // tout le monde peut écrire dans la messagerie
};
const DEFAULT_READ_ONLY_ROLES = { reports: ['accountant'] }; // rapports : comptable seulement (en plus de l'administrateur)
// Aucun accès par défaut hors administrateur (D1 : paiements sauf comptable ; D2 : RH réservées à l'administrateur).
const DEFAULT_HIDDEN = {
  payments: ['gerant', 'teacher', 'staff', 'user'],
  hr: ['gerant', 'teacher', 'accountant', 'staff', 'user']
};

function defaultLevel(role, module) {
  if (role === 'admin') return 'write';
  if (role === 'parent') return 'none';
  if ((DEFAULT_WRITE[module] || []).includes(role)) return 'write';
  if ((DEFAULT_HIDDEN[module] || []).includes(role)) return 'none';
  if (DEFAULT_READ_ONLY_ROLES[module]) return DEFAULT_READ_ONLY_ROLES[module].includes(role) ? 'read' : 'none';
  return 'read';
}

async function loadOverrides(tenantId) {
  const r = await db.query('SELECT role, module, level FROM role_permissions WHERE tenant_id = $1', [tenantId]);
  const map = {};
  for (const row of r.rows) (map[row.role] = map[row.role] || {})[row.module] = row.level;
  return map;
}

function levelFrom(overrides, role, module) {
  if (role === 'admin') return 'write';
  if (role === 'parent') return 'none';
  if (!Object.prototype.hasOwnProperty.call(MODULES, module)) return 'none';
  const o = overrides[role] && overrides[role][module];
  return LEVELS.includes(o) ? o : defaultLevel(role, module);
}

// Matrice complète effective d'un établissement : { rôle: { module: niveau } }.
async function matrix(tenantId) {
  const overrides = await loadOverrides(tenantId);
  const out = {};
  for (const role of ROLES) { out[role] = {}; for (const m of Object.keys(MODULES)) out[role][m] = levelFrom(overrides, role, m); }
  return { matrix: out, overrides };
}

async function permissionsFor(tenantId, role) {
  const overrides = await loadOverrides(tenantId);
  const out = {};
  for (const m of Object.keys(MODULES)) out[m] = levelFrom(overrides, role, m);
  return out;
}

// Le niveau est mis en cache sur la requête : une seule lecture en base même si plusieurs gardes s'enchaînent.
async function requestLevel(req, module) {
  if (!req.user) return 'none';
  if (req.user.role === 'admin') return 'write';
  if (!req._permOverrides) req._permOverrides = await loadOverrides(req.tenantId);
  return levelFrom(req._permOverrides, req.user.role, module);
}

function deny(res, need) {
  return res.status(403).json({ error: need === 'write' ? 'Droits insuffisants pour modifier ce module.' : 'Vous n’avez pas accès à ce module.', code: 'module_forbidden' });
}

// Garde de lecture à monter devant un module : toute requête GET/HEAD exige au moins « lecture ».
const gateRead = (module) => async (req, res, next) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (RANK[await requestLevel(req, module)] >= RANK.read) return next();
    return deny(res, 'read');
  } catch (e) { return next(e); }
};

// Garde d'écriture (remplace requireRole sur les actions de modification).
const requireWrite = (module) => async (req, res, next) => {
  try {
    if (RANK[await requestLevel(req, module)] >= RANK.write) return next();
    return deny(res, 'write');
  } catch (e) { return next(e); }
};

module.exports = { LEVELS, ROLES, MODULES, defaultLevel, matrix, permissionsFor, gateRead, requireWrite };
