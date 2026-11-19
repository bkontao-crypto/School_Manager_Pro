// Bulletin de notes au format PDF (A4), généré côté serveur à partir de loadReportCard().
// Mise en page : bandeau de marque, carte élève, indicateurs colorés, graphique des moyennes (si ≤ 12 matières),
// tableau à lignes alternées (en-tête répété), appréciation, signatures, pied de page numéroté sur chaque page.

const { Pdf, wrap, textWidth } = require('./pdf');

const C = {
  brand: '#1E3A8A', brandDark: '#172554', accent: '#F59E0B', ink: '#1E293B', text: '#334155', muted: '#64748B',
  zebra: '#F1F5F9', border: '#E2E8F0', panel: '#F8FAFC', track: '#E2E8F0', white: '#FFFFFF', headLight: '#BFDBFE',
  good: '#059669', info: '#2563EB', warn: '#D97706', bad: '#DC2626', goodLight: '#ECFDF5', goodInk: '#065F46'
};
const L = 40;

const round2 = (v) => Math.round(Number(v) * 100) / 100;
const fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(round2(v)).replace('.', ','));
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const todayFr = () => new Date().toISOString().slice(0, 10).split('-').reverse().join('/');

// Niveau de couleur d'une moyenne ramenée sur 20.
const levelColor = (v20) => (v20 === null || v20 === undefined ? C.muted : v20 >= 12 ? C.good : v20 >= 10 ? C.info : v20 >= 8 ? C.warn : C.bad);
const mentionColor = (m) => (!m ? C.muted : m === 'Très bien' || m === 'Bien' ? C.good : m === 'Insuffisant' ? C.bad : C.info);

function renderReportCard(data, schoolName) {
  const pdf = new Pdf(); const W = pdf.width; const H = pdf.height; const R = W - L; const CW = R - L;
  const s = data.student; const scale = Number(data.grade_scale_max) || 20;
  const org = schoolName || 'Établissement';
  const name = `${s.first_name} ${s.last_name}`;
  const periodTxt = data.period.from || data.period.to
    ? `Période : ${data.period.from ? `du ${dateFr(data.period.from)}` : ''} ${data.period.to ? `au ${dateFr(data.period.to)}` : ''}`.replace(/\s+/g, ' ').trim()
    : 'Période : année complète';
  const to20 = (avg) => (avg === null || avg === undefined ? null : (Number(avg) * 20) / scale);

  // Bandeau de marque ; renvoie l'ordonnée du bas du bandeau.
  const band = (first) => {
    const bh = first ? 96 : 46;
    pdf.rect(0, H - bh, W, bh, { fill: C.brand });
    pdf.rect(0, H - bh - 4, W, 4, { fill: C.accent });
    if (first) {
      pdf.text(L, H - 40, org, { size: 18, bold: true, color: C.white });
      pdf.text(L, H - 61, 'BULLETIN DE NOTES', { size: 10, bold: true, color: C.headLight });
      if (s.school_year) pdf.text(R, H - 40, `Année scolaire ${s.school_year}`, { size: 10, color: C.white, align: 'right' });
      pdf.text(R, H - 61, periodTxt, { size: 9, color: C.headLight, align: 'right' });
    } else {
      pdf.text(L, H - 29, org, { size: 11, bold: true, color: C.white });
      pdf.text(R, H - 29, `Bulletin de ${name}`, { size: 9, color: C.headLight, align: 'right' });
    }
    return H - bh - 4;
  };
  // Nouvelle page : ajoute la page puis dessine son bandeau ; renvoie l'ordonnée de départ du contenu.
  const newPage = (first) => { pdf.addPage(); return band(first) - 26; };

  // En-tête de tableau (fond de marque, libellés blancs) ; renvoie l'ordonnée sous l'en-tête.
  const tableHead = (y) => {
    pdf.rect(L, y - 20, CW, 20, { fill: C.brand });
    const b = y - 13;
    pdf.text(L + 12, b, 'MATIÈRE', { size: 8, bold: true, color: C.white });
    pdf.text(L + 270, b, 'COEF.', { size: 8, bold: true, color: C.white, align: 'center' });
    pdf.text(L + 322, b, 'NOTES', { size: 8, bold: true, color: C.white, align: 'center' });
    pdf.text(R - 110, b, 'MOYENNE', { size: 8, bold: true, color: C.white, align: 'right' });
    pdf.text(R - 12, b, 'APPRÉCIATION', { size: 8, bold: true, color: C.white, align: 'right' });
    return y - 20;
  };

  // ── Page 1 ──
  let y = band(true) - 26;

  // Carte élève
  pdf.rect(L, y - 58, CW, 58, { fill: C.panel, stroke: C.border, radius: 8 });
  pdf.text(L + 16, y - 24, name, { size: 15, bold: true, color: C.brandDark });
  pdf.text(L + 16, y - 42, `Matricule : ${s.matricule || '-'}   |   Classe : ${s.class_name || 'Sans classe'}${s.date_of_birth ? `   |   Né(e) le ${dateFr(s.date_of_birth)}` : ''}`, { size: 9, color: C.muted });
  y -= 58 + 20;

  // Indicateurs colorés
  const ov20 = to20(data.overall_average);
  const kpis = [
    { label: 'MOYENNE GÉNÉRALE', value: data.overall_average === null ? '-' : `${fmt(data.overall_average)} / ${scale}`, sub: data.overall_average === null ? 'Aucune note validée' : 'Moyenne pondérée', color: levelColor(ov20), valueSize: 17 },
    { label: 'RANG DANS LA CLASSE', value: data.rank ? `${data.rank} / ${data.class_size}` : '-', sub: data.rank ? 'Classement de la période' : 'Non calculé', color: C.info, valueSize: 17 },
    { label: 'MENTION', value: data.mention || '-', sub: 'Mention générale', color: mentionColor(data.mention), valueSize: 14 },
    { label: 'MATIÈRES', value: String(data.subjects.length), sub: `${data.subjects.reduce((n, r) => n + (Number(r.notes) || 0), 0)} note(s) retenue(s)`, color: C.brand, valueSize: 17 }
  ];
  const gap = 10; const kw = (CW - gap * 3) / 4;
  kpis.forEach((k, i) => {
    const x = L + i * (kw + gap);
    pdf.rect(x, y - 70, kw, 70, { fill: C.white, stroke: C.border, radius: 8 });
    pdf.rect(x, y - 4, kw, 4, { fill: k.color });
    pdf.text(x + 12, y - 20, k.label, { size: 7, bold: true, color: C.muted });
    pdf.text(x + 12, y - 45, k.value, { size: k.valueSize, bold: true, color: k.color });
    pdf.text(x + 12, y - 62, k.sub, { size: 7.5, color: C.muted });
  });
  y -= 70 + 24;

  // Graphique des moyennes (lisible jusqu'à 12 matières)
  const withChart = data.subjects.length > 0 && data.subjects.length <= 12;
  if (withChart) {
    pdf.text(L, y, 'Moyennes par matière', { size: 11, bold: true, color: C.brandDark });
    pdf.text(R, y + 1, `Ramenées sur 20 · trait : seuil de 10/20`, { size: 7.5, color: C.muted, align: 'right' });
    y -= 16;
    const rowH = 19; const x0 = L + 140; const trackW = R - 80 - x0; const top = y;
    data.subjects.forEach((r, i) => {
      const rowY = top - i * rowH - 13;
      const v20 = to20(r.average);
      pdf.text(L, rowY, r.subject, { size: 9, color: C.text });
      pdf.rect(x0, rowY - 3, trackW, 10, { fill: C.track, radius: 5 });
      if (v20 !== null) {
        const frac = Math.min(1, Math.max(0, v20 / 20));
        pdf.rect(x0, rowY - 3, Math.max(4, frac * trackW), 10, { fill: levelColor(v20), radius: 5 });
      }
      pdf.text(R, rowY - 1, v20 === null ? '-' : `${fmt(r.average)} / ${scale}`, { size: 8.5, bold: true, color: levelColor(v20), align: 'right' });
    });
    const bottom = top - data.subjects.length * rowH;
    pdf.line(x0 + trackW / 2, bottom + 4, x0 + trackW / 2, top - 2, { color: C.muted, width: 0.6 });
    y = bottom - 14;
  }

  // Tableau à lignes alternées
  if (y < 230) { y = newPage(false); }
  pdf.text(L, y, 'Détail par matière', { size: 11, bold: true, color: C.brandDark });
  y -= 10;
  y = tableHead(y);
  if (!data.subjects.length) {
    pdf.text(L + 12, y - 14, 'Aucune note validée sur cette période.', { size: 9, color: C.muted });
    y -= 22;
  }
  data.subjects.forEach((r, i) => {
    if (y - 20 < 170) { y = newPage(false); y = tableHead(y); }
    const v20 = to20(r.average);
    if (i % 2 === 0) pdf.rect(L, y - 20, CW, 20, { fill: C.zebra });
    const b = y - 13;
    pdf.text(L + 12, b, r.subject, { size: 9, color: C.ink });
    pdf.text(L + 270, b, fmt(r.coefficient), { size: 9, color: C.text, align: 'center' });
    pdf.text(L + 322, b, fmt(r.notes), { size: 9, color: C.text, align: 'center' });
    pdf.text(R - 110, b, r.average === null || r.average === undefined ? '-' : `${fmt(r.average)} / ${scale}`, { size: 9, bold: true, color: levelColor(v20), align: 'right' });
    pdf.text(R - 12, b, r.mention || '-', { size: 9, bold: true, color: mentionColor(r.mention), align: 'right' });
    y -= 20;
  });
  y -= 22;

  // Appréciation de l'enseignant
  const hasComment = Boolean(data.comment.teacher_comment);
  const lines = (hasComment ? wrap(data.comment.teacher_comment, CW - 32, 9.5, false) : ['Aucune appréciation saisie.']).slice(0, 10);
  const boxH = 34 + lines.length * 13;
  if (y - boxH < 120) { y = newPage(false); }
  pdf.rect(L, y - boxH, CW, boxH, { fill: C.white, stroke: C.border, radius: 8 });
  pdf.rect(L, y - boxH + 6, 4, boxH - 12, { fill: C.brand });
  pdf.text(L + 16, y - 18, 'Appréciation de l’enseignant', { size: 10, bold: true, color: C.brandDark });
  lines.forEach((ln, i) => pdf.text(L + 16, y - 36 - i * 13, ln, { size: 9.5, color: hasComment ? C.text : C.muted }));
  y -= boxH + 18;

  // Décision du conseil
  if (data.comment.council_decision) {
    if (y - 24 < 120) y = newPage(false);
    const label = `Décision du conseil : ${data.comment.council_decision}`;
    const w = textWidth(label, 10, true) + 28;
    pdf.rect(L, y - 24, w, 24, { fill: C.goodLight, radius: 12 });
    pdf.text(L + 14, y - 16, label, { size: 10, bold: true, color: C.goodInk });
    y -= 40;
  }

  // Signatures
  // Zone de signature fixe en bas de la dernière page.
  const sy = 110;
  pdf.line(L, sy, L + 170, sy, { color: C.muted, width: 0.6 });
  pdf.line(R - 170, sy, R, sy, { color: C.muted, width: 0.6 });
  pdf.text(L, sy - 13, 'Signature de l’enseignant', { size: 8.5, color: C.muted });
  pdf.text(R - 170, sy - 13, 'Signature du directeur', { size: 8.5, color: C.muted });

  // Pied de page sur chaque page
  const n = pdf.pageCount;
  for (let i = 0; i < n; i++) {
    pdf.goto(i);
    pdf.line(L, 36, R, 36, { color: C.border, width: 0.8 });
    pdf.text(L, 24, `${org} · Bulletin de ${name} · Généré le ${todayFr()} · School Manager Pro`, { size: 7.5, color: C.muted });
    pdf.text(R, 24, `Page ${i + 1} / ${n}`, { size: 7.5, bold: true, color: C.brand, align: 'right' });
  }
  return pdf.toBuffer({ title: `Bulletin - ${name}` });
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
