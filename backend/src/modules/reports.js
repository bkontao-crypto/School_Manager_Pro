// Rapports : synthèses calculées en SQL et export CSV des paiements.
// Accès réglé par les permissions du module « rapports » (par défaut : administrateur et comptable), appliquées au montage.

const express = require('express');
const db = require('../utils/db');
const { validate } = require('../utils/validate');
const { wrap, invalid } = require('../utils/http');

const { audit } = require('../utils/audit');

const router = express.Router();
const num = (v) => Number(v || 0);

router.get('/overview', wrap(async (req, res) => {
  const t = req.tenantId;
  const [byClass, byStatus, byFee, totals, att, grades] = await Promise.all([
    db.query(
      `SELECT COALESCE(c.name, 'Sans classe') AS label, count(*) AS total
         FROM students s LEFT JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL GROUP BY 1 ORDER BY 1`, [t]),
    db.query(`SELECT status AS label, count(*) AS total FROM students WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`, [t]),
    db.query(
      `SELECT COALESCE(fee_type, 'Non précisé') AS label, COALESCE(SUM(amount), 0) AS total, count(*) AS count
         FROM payments WHERE tenant_id = $1 AND status = 'paye' GROUP BY 1 ORDER BY 2 DESC`, [t]),
    db.query(
      `SELECT status AS label, COALESCE(SUM(amount), 0) AS total, count(*) AS count FROM payments WHERE tenant_id = $1 GROUP BY 1`, [t]),
    db.query(
      `SELECT status AS label, count(*) AS total FROM attendances WHERE tenant_id = $1 AND date >= current_date - 29 GROUP BY 1 ORDER BY 2 DESC`, [t]),
    db.query(
      `SELECT subject AS label, ROUND(AVG(score)::numeric, 2) AS average, count(*) AS count
         FROM grades WHERE tenant_id = $1 AND status <> 'annulee' GROUP BY 1 ORDER BY 1`, [t])
  ]);
  res.json({
    data: {
      students_by_class: byClass.rows.map((r) => ({ label: r.label, total: num(r.total) })),
      students_by_status: byStatus.rows.map((r) => ({ label: r.label, total: num(r.total) })),
      payments_by_fee: byFee.rows.map((r) => ({ label: r.label, total: num(r.total), count: num(r.count) })),
      payments_by_status: totals.rows.map((r) => ({ label: r.label, total: num(r.total), count: num(r.count) })),
      attendance_30d: att.rows.map((r) => ({ label: r.label, total: num(r.total) })),
      grades_by_subject: grades.rows.map((r) => ({ label: r.label, average: num(r.average), count: num(r.count) }))
    }
  });
}));

const { csvCell } = require('../utils/csv');

router.get('/payments.csv', wrap(async (req, res) => {
  const { values: f, errors } = validate(req.query, { from: { type: 'date' }, to: { type: 'date' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const params = [req.tenantId];
  let where = 'p.tenant_id = $1';
  if (f.from) { params.push(f.from); where += ` AND p.paid_at >= $${params.length}::date`; }
  if (f.to) { params.push(f.to); where += ` AND p.paid_at < ($${params.length}::date + 1)`; }
  const r = await db.query(
    `SELECT p.receipt_number, to_char(p.paid_at, 'YYYY-MM-DD') AS paid_on, s.matricule, s.first_name || ' ' || s.last_name AS student,
            p.fee_type, p.method, p.amount, p.status
       FROM payments p JOIN students s ON s.tenant_id = p.tenant_id AND s.id = p.student_id
      WHERE ${where} ORDER BY p.paid_at DESC, p.receipt_number DESC LIMIT 50000`, params);
  const head = ['Reçu', 'Date', 'Matricule', 'Élève', 'Type de frais', 'Mode', 'Montant (F)', 'Statut'];
  const lines = [head.join(';'), ...r.rows.map((x) => [x.receipt_number, x.paid_on, x.matricule, x.student, x.fee_type, x.method, x.amount, x.status].map(csvCell).join(';'))];
  await audit(req, { action: 'report.export_payments', entity: 'payment', details: { rows: r.rows.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="paiements.csv"');
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

module.exports = router;
