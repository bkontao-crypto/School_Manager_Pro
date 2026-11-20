// Statistiques du tableau de bord : tout est calculé en SQL (aucun tableau complet n'est envoyé au navigateur).
//  - taux de présence : 30 derniers jours, « présent » et « en retard » comptent comme présents ;
//  - encaissements : paiements au statut « paye », par mois civil.

const express = require('express');
const db = require('../utils/db');
const { wrap } = require('../utils/http');
const { permissionsFor } = require('../utils/permissions');

const router = express.Router();

router.get('/dashboard', wrap(async (req, res) => {
  const t = req.tenantId;
  // Garde par module (ordonnance §4.2) : les encaissements suivent le droit de lecture du module « payments » ;
  // le journal d'audit est réservé à l'administrateur.
  const perms = await permissionsFor(t, req.user.role);
  const canPayments = perms.payments === 'read' || perms.payments === 'write';
  const isAdmin = req.user.role === 'admin';
  const empty = (rows) => Promise.resolve({ rows });
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
    canPayments ? db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, count(*) AS count FROM payments
        WHERE tenant_id = $1 AND status = 'paye'
          AND paid_at >= date_trunc('month', now()) AND paid_at < date_trunc('month', now()) + interval '1 month'`,
      [t]
    ) : empty([{ total: 0, count: 0 }]),
    canPayments ? db.query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, COALESCE(SUM(p.amount), 0) AS total
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m(month)
         LEFT JOIN payments p ON p.tenant_id = $1 AND p.status = 'paye' AND date_trunc('month', p.paid_at) = m.month
        GROUP BY m.month ORDER BY m.month`,
      [t]
    ) : empty([]),
    canPayments ? db.query(
      `SELECT p.id, s.first_name || ' ' || s.last_name AS student_name, p.amount, p.fee_type, p.status, p.paid_at
         FROM payments p JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 ORDER BY p.paid_at DESC LIMIT 5`,
      [t]
    ) : empty([]),
    isAdmin ? db.query(
      `SELECT a.action, a.entity, a.created_at, u.full_name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = $1 AND a.action <> 'auth.login' ORDER BY a.created_at DESC LIMIT 6`,
      [t]
    ) : empty([])
  ]);

  // Tendances et séries calculées en SQL. Une tendance vaut null (affichée « Pas de donnée ») si la période de comparaison est vide.
  const [trend, enrol, levels] = await Promise.all([
    db.query(
      `SELECT
         (SELECT count(*) FROM students WHERE tenant_id = $1 AND created_at < date_trunc('month', now())
            AND (deleted_at IS NULL OR deleted_at >= date_trunc('month', now()))) AS students_prev,
         (SELECT count(*) FROM teachers WHERE tenant_id = $1 AND created_at < date_trunc('month', now())) AS teachers_prev,
         (SELECT count(*) FROM classes WHERE tenant_id = $1 AND created_at < date_trunc('month', now())) AS classes_prev,
         (SELECT count(*) FROM attendances WHERE tenant_id = $1 AND date >= current_date - 59 AND date < current_date - 29) AS attendance_total_prev,
         (SELECT count(*) FROM attendances WHERE tenant_id = $1 AND date >= current_date - 59 AND date < current_date - 29
            AND status IN ('present', 'late')) AS attendance_present_prev,
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = $1 AND status = 'paye'
            AND paid_at >= date_trunc('month', now()) - interval '1 month' AND paid_at < date_trunc('month', now())) AS payments_prev`,
      [t]
    ),
    db.query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month,
              (SELECT count(*) FROM students s WHERE s.tenant_id = $1 AND s.created_at < m.month + interval '1 month'
                 AND (s.deleted_at IS NULL OR s.deleted_at >= m.month + interval '1 month')) AS total
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m(month)
        ORDER BY m.month`,
      [t]
    ),
    db.query(
      `SELECT COALESCE(c.level, 'Non renseigné') AS level, count(*) AS count
         FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
        GROUP BY 1 ORDER BY count DESC, 1`,
      [t]
    )
  ]);
  const tr = trend.rows[0];
  const pct = (now, prev) => (Number(prev) > 0 ? Math.round(((Number(now) - Number(prev)) / Number(prev)) * 1000) / 10 : null);
  const prevRate = Number(tr.attendance_total_prev) > 0 ? (Number(tr.attendance_present_prev) / Number(tr.attendance_total_prev)) * 100 : null;
  const c = counts.rows[0];
  const total = Number(c.attendance_total);
  res.json({
    data: {
      students: Number(c.students),
      teachers: Number(c.teachers),
      classes: Number(c.classes),
      grades: Number(c.grades),
      attendance_rate: total > 0 ? Math.round((Number(c.attendance_present) / total) * 1000) / 10 : null,
      trends: {
        students: pct(c.students, tr.students_prev),
        teachers: pct(c.teachers, tr.teachers_prev),
        classes: pct(c.classes, tr.classes_prev),
        attendance: prevRate !== null && total > 0 ? Math.round((((Number(c.attendance_present) / total) * 100) - prevRate) * 10) / 10 : null, // en points
        payments: canPayments ? pct(month.rows[0].total, tr.payments_prev) : null
      },
      enrolment_series: enrol.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
      level_distribution: levels.rows.map((r) => ({ level: r.level, count: Number(r.count) })),
      payments_month: { total: Number(month.rows[0].total), count: Number(month.rows[0].count) },
      payments_series: series.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
      recent_payments: recent.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
      recent_activity: activity.rows
    }
  });
}));

module.exports = router;
