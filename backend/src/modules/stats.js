// Statistiques du tableau de bord : tout est calculé en SQL (aucun tableau complet n'est envoyé au navigateur).
//  - taux de présence : 30 derniers jours, « présent » et « en retard » comptent comme présents ;
//  - encaissements : paiements au statut « paye », par mois civil.

const express = require('express');
const db = require('../utils/db');
const { wrap } = require('../utils/http');

const router = express.Router();

router.get('/dashboard', wrap(async (req, res) => {
  const t = req.tenantId;
  const [counts, month, series, recent, activity] = await Promise.all([
    db.query(
      `SELECT
         (SELECT count(*) FROM students WHERE tenant_id = $1 AND deleted_at IS NULL) AS students,
         (SELECT count(*) FROM teachers WHERE tenant_id = $1) AS teachers,
         (SELECT count(*) FROM classes WHERE tenant_id = $1) AS classes,
         (SELECT count(*) FROM grades WHERE tenant_id = $1 AND status <> 'annulee') AS grades,
         (SELECT count(*) FROM attendances WHERE tenant_id = $1 AND date >= current_date - 29) AS attendance_total,
         (SELECT count(*) FROM attendances WHERE tenant_id = $1 AND date >= current_date - 29
            AND status IN ('present', 'late')) AS attendance_present`,
      [t]
    ),
    db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, count(*) AS count FROM payments
        WHERE tenant_id = $1 AND status = 'paye'
          AND paid_at >= date_trunc('month', now()) AND paid_at < date_trunc('month', now()) + interval '1 month'`,
      [t]
    ),
    db.query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, COALESCE(SUM(p.amount), 0) AS total
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m(month)
         LEFT JOIN payments p ON p.tenant_id = $1 AND p.status = 'paye' AND date_trunc('month', p.paid_at) = m.month
        GROUP BY m.month ORDER BY m.month`,
      [t]
    ),
    db.query(
      `SELECT p.id, s.first_name || ' ' || s.last_name AS student_name, p.amount, p.fee_type, p.status, p.paid_at
         FROM payments p JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 ORDER BY p.paid_at DESC LIMIT 5`,
      [t]
    ),
    db.query(
      `SELECT a.action, a.entity, a.created_at, u.full_name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = $1 AND a.action <> 'auth.login' ORDER BY a.created_at DESC LIMIT 6`,
      [t]
    )
  ]);

  const c = counts.rows[0];
  const total = Number(c.attendance_total);
  res.json({
    data: {
      students: Number(c.students),
      teachers: Number(c.teachers),
      classes: Number(c.classes),
      grades: Number(c.grades),
      attendance_rate: total > 0 ? Math.round((Number(c.attendance_present) / total) * 1000) / 10 : null,
      payments_month: { total: Number(month.rows[0].total), count: Number(month.rows[0].count) },
      payments_series: series.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
      recent_payments: recent.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
      recent_activity: activity.rows
    }
  });
}));

module.exports = router;
