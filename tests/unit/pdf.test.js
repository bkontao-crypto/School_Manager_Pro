const test = require('node:test');
const assert = require('node:assert/strict');
const { Pdf, textWidth, wrap, clean } = require('../../backend/src/utils/pdf');
const { renderReportCard } = require('../../backend/src/utils/reportCardPdf');

test('PDF : structure valide, table xref exacte, accents en WinAnsi', () => {
  const buf = new Pdf().text(50, 700, 'Élève Aïssata – “test” (a\\b)').toBuffer({ title: 'Titre é' });
  const txt = buf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4')); assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.equal(txt.slice(start, start + 4), 'xref');
  const entries = [...txt.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  entries.forEach((o, i) => assert.match(txt.slice(o, o + 12), new RegExp(`^${i + 1} 0 obj`)));
  assert.ok(txt.includes('\xc9l\xe8ve'.replace('è', 'e')) || txt.includes('\xc9l'));
  assert.ok(txt.includes('a\\\\b'));
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
