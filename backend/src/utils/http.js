// Aides HTTP : capture des erreurs async (Express 4 ne le fait pas), pagination, réponses d'erreur homogènes.
// Aucun message d'erreur interne (SQL, noms de tables ou de contraintes) n'est renvoyé au client.

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const wrap = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};

function invalid(res, errors) {
  return res.status(400).json({ error: 'Données invalides', errors });
}

function pageParams(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

// Messages lisibles pour les contraintes connues ; sinon un message générique par code PostgreSQL.
const CONSTRAINT_MESSAGES = {
  students_tenant_id_matricule_key: 'Ce matricule existe déjà.',
  uq_attendances_student_class_date: 'Une présence existe déjà pour cet élève, à cette date et pour cette classe.',
  payments_tenant_receipt_key: 'Ce numéro de reçu existe déjà.',
  tenants_code_key: 'Ce code d’établissement existe déjà.',
  uq_users_tenant_email: 'Cette adresse e-mail est déjà utilisée dans cet établissement.',
  uq_users_superadmin_email: 'Cette adresse e-mail est déjà utilisée.',
  academic_periods_tenant_name_key: 'Une période porte déjà ce nom.',
  menus_tenant_id_date_key: 'Un menu existe déjà pour cette date.'
};

const PG_ERRORS = {
  '23505': [409, 'Cette valeur existe déjà (doublon).'],
  '23503': [422, 'Référence invalide : l’élément lié n’existe pas dans cet établissement, ou il est encore utilisé.'],
  '23514': [422, 'Valeur refusée par les règles de gestion.'],
  '23502': [400, 'Un champ obligatoire est manquant.'],
  '22P02': [400, 'Identifiant ou format invalide.'],
  '22003': [400, 'Valeur numérique hors limites.'],
  '22001': [400, 'Texte trop long.']
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
  if (err && PG_ERRORS[err.code]) {
    const [status, fallback] = PG_ERRORS[err.code];
    return res.status(status).json({ error: CONSTRAINT_MESSAGES[err.constraint] || fallback });
  }
  console.error('[erreur]', req.method, req.originalUrl, err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Erreur interne du serveur.' });
}

function apiNotFound(req, res) {
  res.status(404).json({ error: 'Route introuvable.' });
}

module.exports = { HttpError, wrap, invalid, pageParams, errorHandler, apiNotFound };
