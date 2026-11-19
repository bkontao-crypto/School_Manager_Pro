const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { Pdf, textWidth, wrap, clean } = require('../../backend/src/utils/pdf');
// Contenu des pages, décompressé (les flux sont en FlateDecode).
const contents = (buf) => [...buf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')).join('\n');
const { renderReportCard } = require('../../backend/src/utils/reportCardPdf');

test('PDF : structure valide, table xref exacte, accents en WinAnsi', () => {
  const buf = new Pdf().text(50, 700, 'Élève Aïssata – “test” (a\\b)').toBuffer({ title: 'Titre é' });
  const txt = buf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4')); assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.equal(txt.slice(start, start + 4), 'xref');
  const entries = [...txt.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  entries.forEach((o, i) => assert.match(txt.slice(o, o + 12), new RegExp(`^${i + 1} 0 obj`)));
  const c = contents(buf);
  assert.ok(c.includes('\xc9l\xe8ve'));
  assert.ok(c.includes('a\\\\b'));
});

test('PDF : caractères hors Latin-1 remplacés, largeur et retour à la ligne', () => {
  assert.equal(clean('l’été – ok…'), "l'\xe9t\xe9 - ok...");
  assert.equal(clean('日本'), '??');
  assert.ok(textWidth('Hello', 10, true) > textWidth('Hello', 10, false));
  const lines = wrap('un deux trois quatre cinq six sept huit neuf dix', 60, 10, false);
  assert.ok(lines.length > 2); lines.forEach((l) => assert.ok(textWidth(l, 10, false) <= 60 || !l.includes(' ')));
});

test('Bulletin PDF : beaucoup de matières → plusieurs pages, sans erreur', () => {
  const subjects = Array.from({ length: 60 }, (_, i) => ({ subject: `Matière ${i}`, coefficient: 1, notes: 1, average: 10, mention: 'Passable' }));
  const buf = renderReportCard({ student: { first_name: 'A', last_name: 'B' }, period: { from: '2026-09-01', to: null }, subjects, overall_average: 10, rank: null, class_size: null, mention: 'Passable', comment: { teacher_comment: 'x '.repeat(400), council_decision: null } }, 'École');
  assert.ok((buf.toString('latin1').match(/\/Type \/Page /g) || []).length >= 2);
});

test('Montant en lettres (reçus)', () => {
  const { amountInWords: w } = require('../../backend/src/utils/amountWords');
  const cases = { 0: 'zéro', 21: 'vingt et un', 71: 'soixante et onze', 80: 'quatre-vingts', 81: 'quatre-vingt-un', 100: 'cent', 200: 'deux cents', 201: 'deux cent un', 1000: 'mille', 2000: 'deux mille', 80000: 'quatre-vingt mille', 85000: 'quatre-vingt-cinq mille', 2000000: 'deux millions', 1234567: 'un million deux cent trente-quatre mille cinq cent soixante-sept' };
  for (const [n, txt] of Object.entries(cases)) assert.equal(w(Number(n)), txt, n);
  assert.equal(w(1e15), '');
});

test('PDF : couleurs RGB et hexadécimales, formes arrondies, compression', () => {
  const buf = new Pdf().rect(0, 0, 100, 40, { fill: '#1E3A8A', radius: 8 }).rect(0, 0, 10, 10, { fill: [5, 150, 105], stroke: '#E2E8F0' }).circle(50, 50, 6, { fill: 0.5 }).polyline([[0, 0], [10, 10], [20, 5]], { color: '#DC2626' }).toBuffer();
  const c = contents(buf);
  assert.match(c, / rg\n|rg /); assert.match(c, /RG/); assert.match(c, / c\n|c h/); assert.match(c, / B\n| B/);
  assert.ok(buf.toString('latin1').includes('/Filter /FlateDecode'));
});

test('PDF : pieds de page numérotés en fin de rédaction (goto)', () => {
  const pdf = new Pdf().text(50, 700, 'corps'); pdf.addPage().text(50, 700, 'suite');
  for (let i = 0; i < pdf.pageCount; i++) pdf.goto(i).text(300, 20, `Page ${i + 1} / ${pdf.pageCount}`);
  const c = contents(pdf.toBuffer());
  assert.ok(c.includes('Page 1 / 2') && c.includes('Page 2 / 2'));
});

test('Bulletin PDF : bandeau, indicateurs, graphique et pied de page sur chaque page', () => {
  const subjects = Array.from({ length: 8 }, (_, i) => ({ subject: `Matière ${i}`, coefficient: 2, notes: 2, average: 4 + i * 2, mention: i > 5 ? 'Bien' : 'Insuffisant' }));
  const buf = renderReportCard({ student: { first_name: 'Awa', last_name: 'Traoré', matricule: 'M1', class_name: 'T1', school_year: '2026-2027' }, period: { from: '2026-10-01', to: null }, subjects, grade_scale_max: 20, overall_average: 11, rank: 3, class_size: 30, mention: 'Passable', comment: { teacher_comment: 'Bien.', council_decision: 'Admis' } }, 'École');
  const c = contents(buf);
  assert.ok(c.includes('Page 1 / ') && c.includes('MOYENNE G'));
  assert.ok(/ rg\n| rg /.test(c), 'couleurs de marque présentes');
});

test('Reçu et facture : charte commune, pied de page numéroté, statut lisible', () => {
  const { renderReceipt } = require('../../backend/src/utils/receiptPdf');
  const { renderInvoicePdf } = require('../../backend/src/utils/invoiceData');
  const rc = contents(renderReceipt({ school_name: 'École', first_name: 'A', last_name: 'B', amount: 85000, status: 'paye', receipt_number: 'R-1', fee_type: 'Scolarité', method: 'Espèces', paid_at: '2026-11-18' }));
  assert.ok(rc.includes('ENCAISS') && rc.includes('Page 1 / 1') && rc.includes('Cachet et signature'));
  const rcAnnule = contents(renderReceipt({ school_name: 'École', first_name: 'A', last_name: 'B', amount: 1, status: 'annule', receipt_number: 'R-2' }));
  assert.ok(rcAnnule.includes('ANNUL'));
  const inv = { number: 'FAC-1', document_type: 'invoice', created_at: '2026-11-01', due_date: '2026-11-30', period_start: '2026-11-01', period_end: '2026-11-30', description: 'Abonnement', amount: 1000, subtotal: 1000, discount_amount: 0, tax_amount: 0, tax_rate: 0, status: 'issued', credited: 0, tenant_name: 'Lycée', tenant: {}, issuer: { app_name: 'SMP', legal_details: 'Mentions', payment_instructions: 'Virement' } };
  const fc = contents(renderInvoicePdf(inv));
  assert.ok(fc.includes('FACTURE') && fc.includes('Total TTC') && fc.includes('Page 1 / 1'));
  assert.ok(!fc.includes('Thu ') && !/Generé le [A-Z][a-z]{2} /.test(fc), 'date du pied au format jj/mm/aaaa');
  assert.ok(contents(renderInvoicePdf({ ...inv, document_type: 'credit_note', credit_for_number: 'FAC-0' })).includes('Total de l'));
});
