// Portail parent : un parent connecté ne voit que les élèves rattachés à SA fiche responsable.
// Chaque accès à un enfant est revérifié en base (compte → responsable → lien → élève) ; sinon 404 (jamais d'indice d'existence).
// Routes : GET /children · /children/:id · /children/:id/report-card · /children/:id/photo · /children/:id/timetable

const express = require('express');
const db = require('../utils/db');
const { validate, isUuid } = require('../utils/validate');
const { wrap, invalid, HttpError } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const { loadProfile, loadReportCard } = require('../utils/studentData');
const { loadReceipt, renderReceipt, receiptFilename } = require('../utils/receiptPdf');
const { renderReportCard, filename, sendPdf } = require('../utils/reportCardPdf');

const router = express.Router();
router.use(requireRole('parent'));

async function myChildIds(req) {
  const r = await db.query(
    `SELECT sp.student_id FROM parent_accounts pa
       JOIN student_parents sp ON sp.tenant_id = pa.tenant_id AND sp.parent_id = pa.parent_id
       JOIN students s ON s.tenant_id = sp.tenant_id AND s.id = sp.student_id AND s.deleted_at IS NULL
      WHERE pa.user_id = $1 AND pa.tenant_id = $2`, [req.user.id, req.tenantId]);
  return r.rows.map((x) => x.student_id);
}

async function ownChild(req) {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Enfant introuvable.');
  if (!(await myChildIds(req)).includes(req.params.id)) throw new HttpError(404, 'Enfant introuvable.');
  return req.params.id;
}

router.get('/children', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT s.id, s.matricule, s.first_name, s.last_name, s.status, s.class_id, c.name AS class_name, c.school_year,
            sp.relationship,
            EXISTS (SELECT 1 FROM student_photos ph WHERE ph.tenant_id = s.tenant_id AND ph.student_id = s.id) AS has_photo
       FROM parent_accounts pa
       JOIN student_parents sp ON sp.tenant_id = pa.tenant_id AND sp.parent_id = pa.parent_id
       JOIN students s ON s.tenant_id = sp.tenant_id AND s.id = sp.student_id AND s.deleted_at IS NULL
       LEFT JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id
      WHERE pa.user_id = $1 AND pa.tenant_id = $2 ORDER BY s.last_name, s.first_name`, [req.user.id, req.tenantId]);
  res.json({ data: r.rows });
}));

// Dossier sans les coordonnées des autres responsables ni l'adresse d'urgence d'autrui.
router.get('/children/:id', wrap(async (req, res) => {
  const id = await ownChild(req);
  const data = await loadProfile(req.tenantId, id, { withParents: false, validatedGradesOnly: true });
  if (!data) throw new HttpError(404, 'Enfant introuvable.');
  delete data.parents;
  res.json({ data });
}));

router.get('/children/:id/report-card.pdf', wrap(async (req, res) => {
  const id = await ownChild(req);
  const { values: f, errors } = validate(req.query, { from: { type: 'date' }, to: { type: 'date' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const data = await loadReportCard(req.tenantId, id, f);
  if (!data) throw new HttpError(404, 'Enfant introuvable.');
  const t = await db.query('SELECT name FROM tenants WHERE id = $1', [req.tenantId]);
  sendPdf(res, renderReportCard(data, t.rows[0] && t.rows[0].name), filename(data.student));
}));

router.get('/children/:id/report-card', wrap(async (req, res) => {
  const id = await ownChild(req);
  const { values: f, errors } = validate(req.query, { from: { type: 'date' }, to: { type: 'date' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const data = await loadReportCard(req.tenantId, id, f);
  if (!data) throw new HttpError(404, 'Enfant introuvable.');
  res.json({ data });
}));

router.get('/children/:id/photo', wrap(async (req, res) => {
  const id = await ownChild(req);
  const r = await db.query('SELECT photo, mime FROM student_photos WHERE tenant_id = $1 AND student_id = $2', [req.tenantId, id]);
  if (!r.rows.length) throw new HttpError(404, 'Aucune photo.');
  res.setHeader('Content-Type', r.rows[0].mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(r.rows[0].photo);
}));

router.get('/children/:id/payments/:paymentId/receipt.pdf', wrap(async (req, res) => {
  const id = await ownChild(req);
  if (!isUuid(req.params.paymentId)) throw new HttpError(404, 'Reçu introuvable.');
  const x = await loadReceipt(req.tenantId, req.params.paymentId);
  if (!x || x.student_id !== id || x.status !== 'paye') throw new HttpError(404, 'Reçu introuvable.');
  sendPdf(res, renderReceipt(x), receiptFilename(x));
}));

router.get('/children/:id/timetable', wrap(async (req, res) => {
  const id = await ownChild(req);
  const r = await db.query(
    `SELECT t.id, t.subject, t.day_of_week, to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time, t.room,
            te.first_name || ' ' || te.last_name AS teacher_name
       FROM students s JOIN timetable_slots t ON t.tenant_id = s.tenant_id AND t.class_id = s.class_id
       LEFT JOIN teachers te ON te.tenant_id = t.tenant_id AND te.id = t.teacher_id
      WHERE s.tenant_id = $1 AND s.id = $2 ORDER BY t.day_of_week, t.start_time`, [req.tenantId, id]);
  res.json({ data: r.rows });
}));

module.exports = router;
