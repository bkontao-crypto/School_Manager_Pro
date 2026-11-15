// Bulletin de notes au format PDF (A4), généré côté serveur à partir de loadReportCard().

const { Pdf, wrap } = require('./pdf');

const fmt = (v) => (v === null || v === undefined ? '-' : String(v).replace('.', ','));
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

function renderReportCard(data, schoolName) {
  const pdf = new Pdf(); const L = 50; const R = pdf.width - 50; const s = data.student;
  const header = () => {
    pdf.rect(0, pdf.height - 70, pdf.width, 70, { fill: 0.12 });
    pdf.text(L, pdf.height - 38, schoolName || 'Établissement', { size: 16, bold: true, gray: 1 });
    pdf.text(R, pdf.height - 38, 'BULLETIN DE NOTES', { size: 12, bold: true, align: 'right', gray: 1 });
    if (s.school_year) pdf.text(R, pdf.height - 55, `Année scolaire ${s.school_year}`, { size: 9, align: 'right', gray: 0.85 });
  };
  header();
  let y = pdf.height - 105;
  pdf.text(L, y, `${s.first_name} ${s.last_name}`, { size: 18, bold: true });
  y -= 20;
  pdf.text(L, y, `Matricule : ${s.matricule || '-'}   |   Classe : ${s.class_name || 'Sans classe'}${s.date_of_birth ? `   |   Né(e) le ${dateFr(s.date_of_birth)}` : ''}`, { size: 10, gray: 0.3 });
  y -= 15;
  const per = data.period.from || data.period.to ? `Période : ${data.period.from ? `du ${dateFr(data.period.from)}` : ''} ${data.period.to ? `au ${dateFr(data.period.to)}` : ''}`.replace(/\s+/g, ' ') : 'Période : année complète';
  pdf.text(L, y, per, { size: 10, gray: 0.3 });
  y -= 28;

  const cols = [L + 4, L + 230, L + 285, R - 90, R - 4]; // matière, coef, notes, moyenne (droite), appréciation (droite)
  const head = () => {
    pdf.rect(L, y - 6, R - L, 22, { fill: 0.9 });
    pdf.text(cols[0], y, 'Matière', { size: 10, bold: true }); pdf.text(cols[1], y, 'Coef.', { size: 10, bold: true }); pdf.text(cols[2], y, 'Notes', { size: 10, bold: true });
    pdf.text(cols[3], y, 'Moyenne /20', { size: 10, bold: true, align: 'right' }); pdf.text(cols[4], y, 'Appréciation', { size: 10, bold: true, align: 'right' });
    y -= 24;
  };
  head();
  if (!data.subjects.length) { pdf.text(L + 4, y, 'Aucune note sur cette période.', { size: 10, gray: 0.4 }); y -= 20; }
  for (const r of data.subjects) {
    if (y < 150) { pdf.addPage(); header(); y = pdf.height - 105; head(); }
    pdf.text(cols[0], y, r.subject, { size: 10 }); pdf.text(cols[1], y, fmt(r.coefficient), { size: 10 }); pdf.text(cols[2], y, fmt(r.notes), { size: 10 });
    pdf.text(cols[3], y, fmt(r.average), { size: 10, bold: true, align: 'right' }); pdf.text(cols[4], y, r.mention || '-', { size: 10, align: 'right' });
    pdf.line(L, y - 6, R, y - 6, { gray: 0.85 });
    y -= 20;
  }

  if (y < 260) { pdf.addPage(); header(); y = pdf.height - 105; }
  y -= 24;
  const boxW = (R - L - 20) / 3;
  [['Moyenne générale', data.overall_average === null ? '-' : `${fmt(data.overall_average)} / 20`], ['Rang dans la classe', data.rank ? `${data.rank} / ${data.class_size}` : '-'], ['Mention', data.mention || '-']].forEach(([k, v], i) => {
    const x = L + i * (boxW + 10);
    pdf.rect(x, y - 38, boxW, 50, { fill: 0.96, stroke: 0.8 });
    pdf.text(x + 10, y - 2, k, { size: 9, gray: 0.4 }); pdf.text(x + 10, y - 26, v, { size: 15, bold: true });
  });
  y -= 70;
  pdf.text(L, y, 'Appréciation de l’enseignant', { size: 10, bold: true }); y -= 16;
  const lines = data.comment.teacher_comment ? wrap(data.comment.teacher_comment, R - L, 10, false) : ['Aucune appréciation saisie.'];
  for (const ln of lines.slice(0, 8)) { pdf.text(L, y, ln, { size: 10, gray: data.comment.teacher_comment ? 0.1 : 0.5 }); y -= 14; }
  y -= 8;
  if (data.comment.council_decision) { pdf.text(L, y, `Décision du conseil : ${data.comment.council_decision}`, { size: 11, bold: true }); y -= 20; }
  const sy = Math.min(y - 30, 120);
  pdf.line(L, sy, L + 180, sy, { gray: 0.3 }); pdf.line(R - 180, sy, R, sy, { gray: 0.3 });
  pdf.text(L, sy - 14, 'Signature de l’enseignant', { size: 9, gray: 0.4 }); pdf.text(R - 180, sy - 14, 'Signature du directeur', { size: 9, gray: 0.4 });
  pdf.text(pdf.width / 2, 30, `Document généré le ${dateFr(new Date().toISOString())} - School Manager Pro`, { size: 8, align: 'center', gray: 0.55 });
  return pdf.toBuffer({ title: `Bulletin - ${s.first_name} ${s.last_name}` });
}

const filename = (s) => `bulletin-${String(`${s.last_name}-${s.first_name}`).normalize('NFD').replace(/[^\w-]+/g, '').toLowerCase() || 'eleve'}.pdf`;

function sendPdf(res, buffer, name) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
}

module.exports = { renderReportCard, filename, sendPdf };
