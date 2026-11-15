// Neutralise l'injection de formules dans Excel (cellules commençant par = + - @) et protège les séparateurs.
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
module.exports = { csvCell };

// Réponse CSV pour Excel : séparateur « ; », BOM UTF-8 (accents corrects), cellules protégées contre l'injection de formules.
const fmtValue = (v) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)) : v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'oui' : 'non') : v);
function sendCsv(res, filename, columns, rows) {
  const head = columns.map(([, h]) => csvCell(h)).join(';');
  const body = rows.map((r) => columns.map(([k, , f]) => csvCell(f ? f(r[k], r) : fmtValue(r[k]))).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(`﻿${[head, ...body].join('\r\n')}\r\n`);
}
const EXPORT_MAX = 20000;
module.exports = { csvCell, sendCsv, fmtValue, EXPORT_MAX };
