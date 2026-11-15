// Module Élèves : liste paginée avec recherche, création, dossier individuel, modification, suppression logique.

const express = require('express');
const db = require('../utils/db');
const { validate, isUuid } = require('../utils/validate');
const { wrap, invalid, pageParams, HttpError } = require('../utils/http');
const { requireWrite } = require('../utils/permissions');
const { audit } = require('../utils/audit');
const { checkPhoto, PHOTO_REQUIREMENTS } = require('../utils/image');
const { sendCsv, EXPORT_MAX } = require('../utils/csv');
const { renderReportCard, filename, sendPdf } = require('../utils/reportCardPdf');
const { loadProfile, loadReportCard, periodKey } = require('../utils/studentData');

const router = express.Router();
const STATUSES = ['active', 'inactive', 'suspended', 'graduated', 'transferred'];

const SPEC = {
  matricule: { type: 'string', required: true, max: 50 },
  first_name: { type: 'string', required: true, max: 100 },
  last_name: { type: 'string', required: true, max: 100 },
  date_of_birth: { type: 'date', nullable: true },
  gender: { type: 'enum', values: ['M', 'F'], nullable: true },
  status: { type: 'enum', values: STATUSES },
  class_id: { type: 'uuid', nullable: true },
  photo_url: { type: 'url', nullable: true },
  address: { type: 'text', max: 500, nullable: true },
  emergency_phone: { type: 'string', max: 50, nullable: true }
};

const LIST_COLUMNS = 's.id, s.matricule, s.first_name, s.last_name, s.status, s.class_id, c.name AS class_name';

function checkId(req) {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant élève invalide.');
}

// Export CSV (Excel) : mêmes filtres que la liste, avec classe et responsable principal. Déclaré avant /:id.
router.get('/export.csv', wrap(async (req, res) => {
  const { values: f, errors } = validate(req.query, { q: { type: 'string', max: 100 }, status: { type: 'enum', values: STATUSES }, class_id: { type: 'uuid' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const where = ['s.tenant_id = $1', 's.deleted_at IS NULL']; const params = [req.tenantId];
  if (f.q) { params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.matricule ILIKE $${params.length})`); }
  if (f.status) { params.push(f.status); where.push(`s.status = $${params.length}`); }
  if (f.class_id) { params.push(f.class_id); where.push(`s.class_id = $${params.length}`); }
  const rows = await db.query(
    `SELECT s.matricule, s.last_name, s.first_name, s.date_of_birth, s.gender, s.status, c.name AS class_name, c.level AS class_level, c.school_year,
            s.address, s.emergency_phone, g.name AS guardian, g.phone AS guardian_phone, g.email AS guardian_email
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
       LEFT JOIN LATERAL (SELECT p.first_name || ' ' || p.last_name AS name, p.phone, p.email FROM student_parents sp JOIN parents p ON p.id = sp.parent_id AND p.tenant_id = sp.tenant_id
                           WHERE sp.student_id = s.id AND sp.tenant_id = s.tenant_id ORDER BY sp.is_primary DESC, p.last_name LIMIT 1) g ON TRUE
      WHERE ${where.join(' AND ')} ORDER BY s.last_name, s.first_name LIMIT ${EXPORT_MAX}`, params);
  await audit(req, { action: 'student.export', entity: 'student', details: { rows: rows.rows.length } });
  sendCsv(res, 'eleves.csv', [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['date_of_birth', 'Date de naissance'], ['gender', 'Genre'], ['status', 'Statut'], ['class_name', 'Classe'], ['class_level', 'Niveau'], ['school_year', 'Année scolaire'], ['address', 'Adresse'], ['emergency_phone', 'Téléphone d’urgence'], ['guardian', 'Responsable principal'], ['guardian_phone', 'Téléphone responsable'], ['guardian_email', 'E-mail responsable']], rows.rows);
}));

// Liste : ?q= (nom, prénom ou matricule), ?status=, ?class_id=, ?limit= & ?offset=
router.get('/', wrap(async (req, res) => {
  const { values: f, errors } = validate(req.query, {
    q: { type: 'string', max: 100 },
    status: { type: 'enum', values: STATUSES },
    class_id: { type: 'uuid' }
  }, { partial: true });
  if (errors.length) return invalid(res, errors);

  const { limit, offset } = pageParams(req.query);
  const where = ['s.tenant_id = $1', 's.deleted_at IS NULL'];
  const params = [req.tenantId];
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.matricule ILIKE $${params.length})`);
  }
  if (f.status) { params.push(f.status); where.push(`s.status = $${params.length}`); }
  if (f.class_id) { params.push(f.class_id); where.push(`s.class_id = $${params.length}`); }
  const clause = where.join(' AND ');
  const from = 'students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id';

  const [rows, count] = await Promise.all([
    db.query(`SELECT ${LIST_COLUMNS} FROM ${from} WHERE ${clause} ORDER BY s.last_name, s.first_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]),
    db.query(`SELECT count(*) AS total FROM students s WHERE ${clause}`, params)
  ]);
  res.json({ data: rows.rows, meta: { total: Number(count.rows[0].total), limit, offset } });
}));

router.post('/', requireWrite('students'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, SPEC);
  if (errors.length) return invalid(res, errors);
  const cols = Object.keys(values);
  const result = await db.query(
    `INSERT INTO students (tenant_id${cols.map((c) => `, ${c}`).join('')})
     VALUES ($1${cols.map((_, i) => `, $${i + 2}`).join('')})
     RETURNING id, matricule, first_name, last_name, status, class_id`,
    [req.tenantId, ...cols.map((c) => values[c])]
  );
  await audit(req, { action: 'student.create', entity: 'student', entityId: result.rows[0].id, details: { matricule: values.matricule } });
  res.status(201).json({ data: result.rows[0] });
}));

// Dossier individuel : identité, classe, responsables, notes, présences et paiements.
router.get('/:id/profile', wrap(async (req, res) => {
  checkId(req);
  const data = await loadProfile(req.tenantId, req.params.id);
  if (!data) throw new HttpError(404, 'Élève introuvable.');
  res.json({ data });
}));

// Responsables : ajout (un responsable déjà connu — même e-mail, ou même téléphone et même nom — est réutilisé, ce qui
// permet à un parent de suivre plusieurs enfants avec un seul compte) et retrait du lien.
router.post('/:id/parents', requireWrite('students'), wrap(async (req, res) => {
  checkId(req);
  const { values, errors } = validate(req.body, {
    first_name: { type: 'string', required: true, max: 100 },
    last_name: { type: 'string', required: true, max: 100 },
    phone: { type: 'string', max: 50, nullable: true },
    email: { type: 'string', max: 255, nullable: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Adresse e-mail invalide' },
    relationship: { type: 'string', max: 50, nullable: true },
    is_primary: { type: 'boolean' }
  });
  if (errors.length) return invalid(res, errors);
  const st = await db.query('SELECT 1 FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenantId]);
  if (!st.rows.length) throw new HttpError(404, 'Élève introuvable.');
  let parent = null; let reused = false;
  if (values.email) parent = (await db.query('SELECT id FROM parents WHERE tenant_id = $1 AND lower(email) = lower($2) LIMIT 1', [req.tenantId, values.email])).rows[0];
  if (!parent && values.phone) parent = (await db.query('SELECT id FROM parents WHERE tenant_id = $1 AND phone = $2 AND lower(last_name) = lower($3) LIMIT 1', [req.tenantId, values.phone, values.last_name])).rows[0];
  if (parent) reused = true;
  else parent = (await db.query('INSERT INTO parents (tenant_id, first_name, last_name, phone, email) VALUES ($1, $2, $3, $4, $5) RETURNING id', [req.tenantId, values.first_name, values.last_name, values.phone || null, values.email || null])).rows[0];
  const link = await db.query(
    `INSERT INTO student_parents (tenant_id, student_id, parent_id, relationship, is_primary) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, parent_id) DO NOTHING RETURNING id`,
    [req.tenantId, req.params.id, parent.id, values.relationship || null, !!values.is_primary]);
  if (!link.rows.length) throw new HttpError(409, 'Ce responsable est déjà rattaché à cet élève.');
  await audit(req, { action: 'student.parent_add', entity: 'student', entityId: req.params.id, details: { parent_id: parent.id, reused } });
  res.status(201).json({ data: { parent_id: parent.id, reused } });
}));
router.delete('/:id/parents/:parentId', requireWrite('students'), wrap(async (req, res) => {
  checkId(req);
  if (!isUuid(req.params.parentId)) throw new HttpError(400, 'Identifiant responsable invalide.');
  const r = await db.query('DELETE FROM student_parents WHERE student_id = $1 AND parent_id = $2 AND tenant_id = $3 RETURNING id', [req.params.id, req.params.parentId, req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Lien introuvable.');
  await audit(req, { action: 'student.parent_remove', entity: 'student', entityId: req.params.id, details: { parent_id: req.params.parentId } });
  res.json({ data: { removed: true } });
}));

// Photo de l'élève (téléversement sécurisé) : type vérifié sur la signature binaire, 1 Mo maximum, stockée en base.
const rawPhoto = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: PHOTO_REQUIREMENTS.maxBytes + 1024 });
router.get('/:id/photo', wrap(async (req, res) => {
  checkId(req);
  const r = await db.query(
    `SELECT p.photo, p.mime FROM student_photos p JOIN students s ON s.tenant_id = p.tenant_id AND s.id = p.student_id
      WHERE p.student_id = $1 AND p.tenant_id = $2 AND s.deleted_at IS NULL`, [req.params.id, req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Aucune photo.');
  res.setHeader('Content-Type', r.rows[0].mime);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(r.rows[0].photo);
}));
router.put('/:id/photo', requireWrite('students'), rawPhoto, wrap(async (req, res) => {
  checkId(req);
  const { info, errors } = checkPhoto(req.body);
  if (errors.length) return invalid(res, errors);
  const st = await db.query('SELECT 1 FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenantId]);
  if (!st.rows.length) throw new HttpError(404, 'Élève introuvable.');
  await db.query(
    `INSERT INTO student_photos (tenant_id, student_id, photo, mime, width, height, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, student_id) DO UPDATE SET photo = EXCLUDED.photo, mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.tenantId, req.params.id, req.body, info.mime, info.width, info.height, req.user.id]);
  await audit(req, { action: 'student.photo', entity: 'student', entityId: req.params.id });
  res.json({ data: { has_photo: true, width: info.width, height: info.height, bytes: info.bytes } });
}));
router.delete('/:id/photo', requireWrite('students'), wrap(async (req, res) => {
  checkId(req);
  await db.query('DELETE FROM student_photos WHERE student_id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  await audit(req, { action: 'student.photo_remove', entity: 'student', entityId: req.params.id });
  res.json({ data: { has_photo: false } });
}));

// Bulletin : moyennes pondérées par matière et générale (notes non annulées), rang dans la classe, appréciation.
const DECISIONS = ['Félicitations', 'Encouragements', 'Tableau d’honneur', 'Avertissement travail', 'Avertissement conduite', 'Blâme'];

// Appréciation de l'enseignant / décision du conseil, par élève et par période (mêmes bornes que le bulletin).
router.put('/:id/report-card/comment', requireWrite('grades'), wrap(async (req, res) => {
  checkId(req);
  const { values, errors } = validate(req.body, {
    from: { type: 'date' }, to: { type: 'date' },
    teacher_comment: { type: 'string', max: 600, nullable: true },
    council_decision: { type: 'enum', values: DECISIONS, nullable: true }
  }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const b = req.body || {};
  const comment = Object.prototype.hasOwnProperty.call(b, 'teacher_comment') ? (values.teacher_comment || null) : undefined;
  const decision = Object.prototype.hasOwnProperty.call(b, 'council_decision') ? (values.council_decision || null) : undefined;
  if (comment === undefined && decision === undefined) throw new HttpError(400, 'Aucun champ à enregistrer.');
  const st = await db.query('SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenantId]);
  if (!st.rows.length) throw new HttpError(404, 'Élève introuvable.');
  const key = periodKey(values);
  const r = await db.query(
    `INSERT INTO report_card_comments (tenant_id, student_id, period_key, teacher_comment, council_decision, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, student_id, period_key) DO UPDATE SET
       teacher_comment = CASE WHEN $7 THEN EXCLUDED.teacher_comment ELSE report_card_comments.teacher_comment END,
       council_decision = CASE WHEN $8 THEN EXCLUDED.council_decision ELSE report_card_comments.council_decision END,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING teacher_comment, council_decision, updated_at`,
    [req.tenantId, req.params.id, key, comment === undefined ? null : comment, decision === undefined ? null : decision, req.user.id, comment !== undefined, decision !== undefined]);
  await audit(req, { action: 'student.report_comment', entity: 'student', entityId: req.params.id });
  res.json({ data: r.rows[0] });
}));

router.get('/:id/report-card.pdf', wrap(async (req, res) => {
  checkId(req);
  const { values: f, errors } = validate(req.query, { from: { type: 'date' }, to: { type: 'date' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const data = await loadReportCard(req.tenantId, req.params.id, f);
  if (!data) throw new HttpError(404, 'Élève introuvable.');
  const t = await db.query('SELECT name FROM tenants WHERE id = $1', [req.tenantId]);
  sendPdf(res, renderReportCard(data, t.rows[0] && t.rows[0].name), filename(data.student));
}));
router.get('/:id/report-card', wrap(async (req, res) => {
  checkId(req);
  const { values: f, errors } = validate(req.query, { from: { type: 'date' }, to: { type: 'date' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const data = await loadReportCard(req.tenantId, req.params.id, f);
  if (!data) throw new HttpError(404, 'Élève introuvable.');
  res.json({ data });
}));

router.put('/:id', requireWrite('students'), wrap(async (req, res) => {
  checkId(req);
  const { values, errors } = validate(req.body, SPEC, { partial: true });
  if (errors.length) return invalid(res, errors);
  const cols = Object.keys(values);
  if (!cols.length) throw new HttpError(400, 'Aucun champ à modifier.');
  const assignments = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const result = await db.query(
    `UPDATE students SET ${assignments}
      WHERE id = $${cols.length + 1} AND tenant_id = $${cols.length + 2} AND deleted_at IS NULL
      RETURNING id, matricule, first_name, last_name, status, class_id`,
    [...cols.map((c) => values[c]), req.params.id, req.tenantId]
  );
  if (!result.rows.length) throw new HttpError(404, 'Élève introuvable.');
  await audit(req, { action: 'student.update', entity: 'student', entityId: req.params.id, details: { fields: cols } });
  res.json({ data: result.rows[0] });
}));

// Suppression LOGIQUE : l'élève disparaît des listes, son historique (notes, présences, paiements) est conservé.
router.delete('/:id', requireWrite('students'), wrap(async (req, res) => {
  checkId(req);
  const result = await db.query(
    `UPDATE students SET deleted_at = NOW(), status = 'inactive'
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, req.tenantId]
  );
  if (!result.rows.length) throw new HttpError(404, 'Élève introuvable.');
  await audit(req, { action: 'student.delete', entity: 'student', entityId: req.params.id });
  res.json({ data: { id: result.rows[0].id } });
}));

module.exports = router;
