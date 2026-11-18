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
    coefficient: { type: 'number', exclusiveMin: 0, max: 9.99, default: 1 }
  },
  // Statut imposé côté serveur : le client ne peut pas créer une note déjà validée.
  defaults: () => ({ status: 'saisie' }),
  module: 'grades',
  exportCsv: { filename: 'notes.csv', columns: [['student_name', 'Élève'], ['subject', 'Matière'], ['evaluation_type', 'Évaluation'], ['score', 'Note /20'], ['coefficient', 'Coefficient'], ['date', 'Date'], ['status', 'Statut']] }
});

// Transition gardée : la mise à jour ne réussit que si la note est dans l'état attendu, dans l'établissement de l'utilisateur.
const transition = (from, to, action) => wrap(async (req, res) => {
  const r = await db.query(
    'UPDATE grades SET status = $3 WHERE id = $1 AND tenant_id = $2 AND status = $4 RETURNING id, status',
    [req.params.id, req.tenantId, to, from]
  );
  if (!r.rows.length) {
    const current = await db.query('SELECT status FROM grades WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!current.rows.length) throw new HttpError(404, 'Note introuvable.');
    throw new HttpError(409, `Action impossible : la note est « ${current.rows[0].status} ».`);
  }
  await audit(req, { action: `grade.${action}`, entity: 'grade', entityId: req.params.id, details: { from, to } });
  res.json({ data: r.rows[0] });
});

router.post('/:id/validate', requireRole('admin'), transition('saisie', 'validee', 'validate'));
router.post('/:id/cancel', requireRole('admin'), transition('saisie', 'annulee', 'cancel'));

module.exports = router;
