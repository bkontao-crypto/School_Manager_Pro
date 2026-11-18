// Module Notes (barème sur 20, cohérent avec la contrainte grades_score_check de la migration 013).
// Cycle de vie (ordonnance §6.4) : une note est créée en « saisie » quel que soit le statut envoyé par le client.
// Seule l'administration (responsable pédagogique) valide ou annule, et seulement depuis « saisie » :
//   saisie → validee   (POST /:id/validate)
//   saisie → annulee   (POST /:id/cancel)
// Les notes validées ou annulées ne sont plus modifiables ici ; leur correction relève de PH1-09 (procédure tracée).

const express = require('express');
const db = require('../utils/db');
const { HttpError, wrap } = require('../utils/http');
const { makeResource } = require('../utils/resource');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { isUuid } = require('../utils/validate');
const { requireWrite } = require('../utils/permissions');

const MIN_MOTIF = 5;
const checkMotif = (reason) => {
  if (typeof reason !== 'string' || reason.trim().length < MIN_MOTIF) throw new HttpError(400, `Motif obligatoire (${MIN_MOTIF} caractères minimum).`);
  return reason.trim();
};

const router = makeResource({
  entity: 'grade',
  table: 'grades',
  from: `grades g JOIN students s ON s.id = g.student_id AND s.tenant_id = g.tenant_id`,
  tenantCol: 'g.tenant_id',
  select: `g.id, g.student_id, s.first_name || ' ' || s.last_name AS student_name, g.subject, g.evaluation_type,
           g.score, g.coefficient, g.date, g.status`,
  orderBy: 'g.created_at DESC',
  filters: {
    student_id: { type: 'uuid', column: 'g.student_id' },
    status: { type: 'enum', values: ['saisie', 'validee', 'annulee'], column: 'g.status' }
  },
  fields: {
    student_id: { type: 'uuid', required: true },
    subject: { type: 'string', required: true, max: 100 },
    evaluation_type: { type: 'string', max: 50 },
    score: { type: 'number', required: true, min: 0, max: 20 },
    // La colonne est DECIMAL(3,2) : le coefficient ne peut pas dépasser 9,99.
    coefficient: { type: 'number', exclusiveMin: 0, max: 9.99, default: 1 },
    date: { type: 'date' }
  },
  // Statut imposé côté serveur : le client ne peut pas créer une note déjà validée.
  defaults: () => ({ status: 'saisie' }),
  // Une période clôturée ne reçoit plus de notes (ordonnance §5.2).
  guard: async (req, values) => {
    if (!values.date) return;
    const r = await db.query(
      'SELECT name FROM academic_periods WHERE tenant_id = $1 AND closed_at IS NOT NULL AND $2::date BETWEEN start_date AND end_date LIMIT 1',
      [req.tenantId, values.date]
    );
    if (r.rows.length) throw new HttpError(409, `La période « ${r.rows[0].name} » est clôturée : aucune note ne peut y être ajoutée.`);
  },
  module: 'grades',
  exportCsv: { filename: 'notes.csv', columns: [['student_name', 'Élève'], ['subject', 'Matière'], ['evaluation_type', 'Évaluation'], ['score', 'Note /20'], ['coefficient', 'Coefficient'], ['date', 'Date'], ['status', 'Statut']] }
});

// La date de la note tombe dans une période clôturée de son établissement (expression SQL réutilisable).
const inClosedPeriod = (a) => `EXISTS (SELECT 1 FROM academic_periods p WHERE p.tenant_id = ${a}.tenant_id AND p.closed_at IS NOT NULL AND ${a}.date BETWEEN p.start_date AND p.end_date)`;

// Transition gardée : la mise à jour ne réussit que si la note est dans l'état attendu, hors période clôturée, dans l'établissement de l'utilisateur.
const transition = (from, to, action) => wrap(async (req, res) => {
  const r = await db.query(
    `UPDATE grades SET status = $3 WHERE id = $1 AND tenant_id = $2 AND status = $4 AND NOT ${inClosedPeriod('grades')} RETURNING id, status`,
    [req.params.id, req.tenantId, to, from]
  );
  if (!r.rows.length) {
    const current = await db.query(
      `SELECT g.status, ${inClosedPeriod('g')} AS locked FROM grades g WHERE g.id = $1 AND g.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!current.rows.length) throw new HttpError(404, 'Note introuvable.');
    if (current.rows[0].locked) throw new HttpError(409, 'Action impossible : la période de cette note est clôturée.');
    throw new HttpError(409, `Action impossible : la note est « ${current.rows[0].status} ».`);
  }
  await audit(req, { action: `grade.${action}`, entity: 'grade', entityId: req.params.id, details: { from, to } });
  res.json({ data: r.rows[0] });
});

router.post('/:id/validate', requireRole('admin'), transition('saisie', 'validee', 'validate'));
router.post('/:id/cancel', requireRole('admin'), transition('saisie', 'annulee', 'cancel'));

// ---- Corrections d'une note validée (PH1-09) ----
// Demande : toute personne pouvant écrire dans les notes, sur une note validée, avec motif.
// Décision : administrateur, différent du demandeur, avec motif. Une seule demande en attente par note (index unique).
router.post('/:id/corrections', requireWrite('grades'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const newScore = Number(req.body && req.body.score);
  if (!(Number.isFinite(newScore) && newScore >= 0 && newScore <= 20)) throw new HttpError(400, 'Note invalide (entre 0 et 20).');
  const reason = checkMotif(req.body && req.body.reason);
  const g = await db.query('SELECT status, score FROM grades WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!g.rows.length) throw new HttpError(404, 'Note introuvable.');
  if (g.rows[0].status !== 'validee') throw new HttpError(409, 'Seule une note validée peut faire l’objet d’une correction.');
  let row;
  try {
    const r = await db.query(
      `INSERT INTO grade_corrections (tenant_id, grade_id, requested_by, reason, old_score, new_score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, grade_id, status, old_score, new_score, reason, created_at`,
      [req.tenantId, req.params.id, req.user.id, reason, g.rows[0].score, newScore]
    );
    row = r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Une correction est déjà en attente pour cette note.');
    throw e;
  }
  await audit(req, { action: 'grade.correction_request', entity: 'grade', entityId: req.params.id, details: { correction_id: row.id, old_score: row.old_score, new_score: newScore } });
  res.status(201).json({ data: row });
}));

// Liste des demandes en attente (administrateur).
router.get('/corrections', requireRole('admin'), wrap(async (req, res) => {
  const r = await db.query(
    `SELECT c.id, c.grade_id, c.requested_by, c.old_score, c.new_score, c.reason, c.created_at,
            u.full_name AS requested_by_name, g.subject, g.evaluation_type, s.first_name || ' ' || s.last_name AS student_name
       FROM grade_corrections c
       JOIN grades g ON g.id = c.grade_id AND g.tenant_id = c.tenant_id
       JOIN students s ON s.id = g.student_id AND s.tenant_id = g.tenant_id
       JOIN users u ON u.id = c.requested_by AND u.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.status = 'pending'
      ORDER BY c.created_at`,
    [req.tenantId]
  );
  res.json({ data: r.rows });
}));

// Décision de l'administrateur. Le demandeur ne peut pas décider de sa propre demande. Approbation : la note reçoit la nouvelle valeur.
async function decideCorrection(req, res, decision) {
  if (!isUuid(req.params.cid)) throw new HttpError(400, 'Identifiant invalide.');
  const reason = checkMotif(req.body && req.body.reason);
  const data = await db.withTransaction(async (client) => {
    const c = await client.query('SELECT * FROM grade_corrections WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.cid, req.tenantId]);
    if (!c.rows.length) throw new HttpError(404, 'Demande introuvable.');
    const cor = c.rows[0];
    if (cor.status !== 'pending') throw new HttpError(409, 'Cette demande a déjà été traitée.');
    if (cor.requested_by === req.user.id) throw new HttpError(403, 'Le demandeur ne peut pas décider de sa propre demande.');
    if (decision === 'approved') {
      const g = await client.query(
        "UPDATE grades SET score = $3 WHERE id = $1 AND tenant_id = $2 AND status = 'validee' RETURNING id",
        [cor.grade_id, req.tenantId, cor.new_score]
      );
      if (!g.rows.length) throw new HttpError(409, 'La note n’est plus validée : correction impossible.');
    }
    const u = await client.query(
      `UPDATE grade_corrections SET status = $3, decided_by = $4, decided_at = now(), decision_reason = $5
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, grade_id, status, old_score, new_score, decided_at`,
      [req.params.cid, req.tenantId, decision, req.user.id, reason]
    );
    return u.rows[0];
  });
  await audit(req, {
    action: decision === 'approved' ? 'grade.correction_approve' : 'grade.correction_reject',
    entity: 'grade', entityId: data.grade_id,
    details: { correction_id: data.id, old_score: data.old_score, new_score: data.new_score, reason }
  });
  res.json({ data });
}

router.post('/corrections/:cid/approve', requireRole('admin'), wrap((req, res) => decideCorrection(req, res, 'approved')));
router.post('/corrections/:cid/reject', requireRole('admin'), wrap((req, res) => decideCorrection(req, res, 'rejected')));

// Retrait par l'auteur de sa propre demande en attente (décision 1 : évite qu'une demande reste bloquée
// quand l'administrateur est aussi son auteur). La décision est tracée avec motif, comme une décision d'administrateur.
router.post('/corrections/:cid/withdraw', requireWrite('grades'), wrap(async (req, res) => {
  if (!isUuid(req.params.cid)) throw new HttpError(400, 'Identifiant invalide.');
  const reason = checkMotif(req.body && req.body.reason);
  const r = await db.query(
    `UPDATE grade_corrections SET status = 'withdrawn', decided_by = $3, decided_at = now(), decision_reason = $4
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending' AND requested_by = $3
      RETURNING id, grade_id, status, old_score, new_score, decided_at`,
    [req.params.cid, req.tenantId, req.user.id, reason]
  );
  if (!r.rows.length) {
    const c = await db.query('SELECT status, requested_by FROM grade_corrections WHERE id = $1 AND tenant_id = $2', [req.params.cid, req.tenantId]);
    if (!c.rows.length) throw new HttpError(404, 'Demande introuvable.');
    if (c.rows[0].requested_by !== req.user.id) throw new HttpError(403, 'Seul le demandeur peut retirer sa demande.');
    throw new HttpError(409, 'Cette demande n’est plus en attente.');
  }
  await audit(req, { action: 'grade.correction_withdraw', entity: 'grade', entityId: r.rows[0].grade_id, details: { correction_id: r.rows[0].id, reason } });
  res.json({ data: r.rows[0] });
}));

module.exports = router;
