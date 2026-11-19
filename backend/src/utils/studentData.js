// Lectures d'un élève partagées entre l'application de l'établissement et le portail parent.
// Chaque fonction exige explicitement l'établissement ; le contrôle d'accès (qui a le droit de voir cet élève) reste à l'appelant.

const db = require('./db');

const mention = (avg) => (avg >= 16 ? 'Très bien' : avg >= 14 ? 'Bien' : avg >= 12 ? 'Assez bien' : avg >= 10 ? 'Passable' : 'Insuffisant');
const periodKey = (f) => (f.from || f.to ? `${f.from || ''}_${f.to || ''}` : 'all');

// Dossier : identité, classe, notes, présences, paiements (et responsables si demandé). null si l'élève n'existe pas.
// validatedGradesOnly : portail parent — seules les notes validées (publiables) sont listées (ordonnance §6.4 et §8.1).
async function loadProfile(tenantId, id, { withParents = true, validatedGradesOnly = false } = {}) {
  const student = await db.query(
    `SELECT s.id, s.matricule, s.first_name, s.last_name, s.date_of_birth, s.gender, s.status, s.class_id,
            s.photo_url, s.address, s.emergency_phone, s.created_at,
            EXISTS (SELECT 1 FROM student_photos sp WHERE sp.tenant_id = s.tenant_id AND sp.student_id = s.id) AS has_photo,
            c.name AS class_name, c.level AS class_level, c.school_year
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL LIMIT 1`, [id, tenantId]);
  if (!student.rows.length) return null;
  const [parents, grades, attendances, payments] = await Promise.all([
    withParents ? db.query(
      `SELECT p.id, p.first_name, p.last_name, p.phone, p.email, p.notify_email, p.notify_sms, p.notify_whatsapp, sp.relationship, sp.is_primary,
              (pa.user_id IS NOT NULL) AS has_account, u.email AS account_email, u.is_active AS account_active
         FROM student_parents sp JOIN parents p ON p.id = sp.parent_id AND p.tenant_id = sp.tenant_id
         LEFT JOIN parent_accounts pa ON pa.tenant_id = p.tenant_id AND pa.parent_id = p.id
         LEFT JOIN users u ON u.id = pa.user_id
        WHERE sp.student_id = $1 AND sp.tenant_id = $2
        ORDER BY sp.is_primary DESC, p.last_name`, [id, tenantId]) : Promise.resolve({ rows: [] }),
    db.query(`SELECT id, subject, evaluation_type, score, coefficient, date, status FROM grades
               WHERE student_id = $1 AND tenant_id = $2 AND status ${validatedGradesOnly ? "= 'validee'" : "<> 'annulee'"} ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 500`, [id, tenantId]),
    db.query(`SELECT a.id, a.class_id, c.name AS class_name, a.date, a.status, a.notes FROM attendances a
                LEFT JOIN classes c ON c.id = a.class_id AND c.tenant_id = a.tenant_id
               WHERE a.student_id = $1 AND a.tenant_id = $2 ORDER BY a.date DESC LIMIT 500`, [id, tenantId]),
    db.query(`SELECT id, amount, fee_type, method, receipt_number, status, paid_at FROM payments
               WHERE student_id = $1 AND tenant_id = $2 ORDER BY paid_at DESC NULLS LAST LIMIT 500`, [id, tenantId])
  ]);
  return { student: student.rows[0], parents: parents.rows, grades: grades.rows, attendances: attendances.rows, payments: payments.rows };
}

// Bulletin : moyennes pondérées par matière et générale (notes VALIDÉES uniquement, ordonnance §6.4), rang dans la classe, appréciation. null si élève absent.
async function loadReportCard(tenantId, id, f = {}) {
  const student = await db.query(
    `SELECT s.id, s.matricule, s.first_name, s.last_name, s.date_of_birth, s.class_id, c.name AS class_name, c.school_year
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL`, [id, tenantId]);
  if (!student.rows.length) return null;
  const st = student.rows[0];
  const params = [tenantId]; let period = '';
  if (f.from) { params.push(f.from); period += ` AND g.date >= $${params.length}`; }
  if (f.to) { params.push(f.to); period += ` AND g.date <= $${params.length}`; }
  const sid = params.push(st.id);
  const subjects = await db.query(
    `SELECT g.subject, SUM(g.score * COALESCE(g.coefficient, 1)) / NULLIF(SUM(COALESCE(g.coefficient, 1)), 0) AS average,
            SUM(COALESCE(g.coefficient, 1)) AS coefficient, count(*) AS notes
       FROM grades g WHERE g.tenant_id = $1 AND g.student_id = $${sid} AND g.status = 'validee'${period}
      GROUP BY g.subject ORDER BY g.subject`, params);
  const toNum = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
  // Barème de l'établissement (10 ou 20) : les mentions restent définies sur 20.
  const sc = await db.query('SELECT grade_scale_max FROM tenants WHERE id = $1', [tenantId]);
  const scale = Number(sc.rows[0] && sc.rows[0].grade_scale_max) || 20;
  const onTwenty = (v) => (v === null || v === undefined ? null : (v * 20) / scale);
  let overall = null; let rank = null; let classSize = null;
  const rowsOut = subjects.rows.map((r) => ({ subject: r.subject, average: toNum(r.average), coefficient: Number(r.coefficient), notes: Number(r.notes), mention: mention(onTwenty(toNum(r.average))) }));
  if (rowsOut.length) {
    const sumCoef = rowsOut.reduce((a, r) => a + r.coefficient, 0);
    overall = toNum(rowsOut.reduce((a, r) => a + r.average * r.coefficient, 0) / sumCoef);
  }
  if (st.class_id && rowsOut.length) {
    const p2 = [tenantId, st.class_id]; let per2 = '';
    if (f.from) { p2.push(f.from); per2 += ` AND g.date >= $${p2.length}`; }
    if (f.to) { p2.push(f.to); per2 += ` AND g.date <= $${p2.length}`; }
    const all = await db.query(
      `SELECT g.student_id, SUM(g.score * COALESCE(g.coefficient, 1)) / NULLIF(SUM(COALESCE(g.coefficient, 1)), 0) AS average
         FROM grades g JOIN students s ON s.tenant_id = g.tenant_id AND s.id = g.student_id
        WHERE g.tenant_id = $1 AND s.class_id = $2 AND s.deleted_at IS NULL AND g.status = 'validee'${per2}
        GROUP BY g.student_id`, p2);
    const avgs = all.rows.map((r) => ({ id: r.student_id, avg: Number(r.average) }));
    classSize = avgs.length;
    const mine = avgs.find((a) => a.id === st.id);
    if (mine) rank = 1 + avgs.filter((a) => a.avg > mine.avg).length;
  }
  const cm = await db.query('SELECT teacher_comment, council_decision, updated_at FROM report_card_comments WHERE tenant_id = $1 AND student_id = $2 AND period_key = $3', [tenantId, st.id, periodKey(f)]);
  return { student: st, comment: cm.rows[0] || { teacher_comment: null, council_decision: null }, period: { from: f.from || null, to: f.to || null }, subjects: rowsOut, overall_average: overall, rank, class_size: classSize, mention: overall === null ? null : mention(onTwenty(overall)), grade_scale_max: scale };
}

module.exports = { mention, periodKey, loadProfile, loadReportCard };
