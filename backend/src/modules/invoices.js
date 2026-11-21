// Factures familiales : grilles de frais, factures par élève, affectation de paiements encaissés.
//
//  - les montants sont recalculés côté serveur (le client ne fournit jamais de total) ;
//  - toute affectation ou annulation s'exécute dans une transaction avec verrous de ligne (facture et paiement) :
//    un même paiement ou une même facture ne peut pas être sur-affecté par deux requêtes concurrentes ;
//  - annuler une facture libère ses affectations (décision Q1) : les montants redeviennent disponibles sur le paiement ;
//  - lecture : droit « Paiements » ; écriture : droit d'écriture « Paiements ».

const db = require('../utils/db');
const { validate, isUuid } = require('../utils/validate');
const { wrap, HttpError, invalid, pageParams } = require('../utils/http');
const { requireWrite } = require('../utils/permissions');
const { audit } = require('../utils/audit');
const { sendPdf } = require('../utils/reportCardPdf');
const { deliver } = require('../utils/mailer');
const { loadFamilyInvoice, invoiceRecipients, renderFamilyInvoice, invoiceFilename, invoiceEmail } = require('../utils/familyInvoicePdf');

const router = require('express').Router();

const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => (c / 100).toFixed(2);
const parseId = (id) => {
  if (!isUuid(id)) throw new HttpError(400, 'Identifiant invalide.');
  return id.toLowerCase();
};

// ---------- Grilles de frais ----------

router.get('/fee-structures', wrap(async (req, res) => {
  const rows = await db.query(
    `SELECT id, label, amount::float8 AS amount FROM fee_structures WHERE tenant_id = $1 ORDER BY label`,
    [req.tenantId]
  );
  res.json({ data: rows.rows });
}));

const FEE_FIELDS = {
  label: { type: 'string', required: true, max: 120 },
  amount: { type: 'number', required: true, min: 0, max: 1000000000 }
};

router.post('/fee-structures', requireWrite('payments'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, FEE_FIELDS);
  if (errors.length) return invalid(res, errors);
  const result = await db.query(
    `INSERT INTO fee_structures (tenant_id, label, amount) VALUES ($1, $2, $3) RETURNING id, label, amount::float8 AS amount`,
    [req.tenantId, values.label, values.amount]
  );
  await audit(req, { action: 'fee_structure.create', entity: 'fee_structure', entityId: result.rows[0].id, details: { label: values.label } });
  res.status(201).json(result.rows[0]);
}));

router.delete('/fee-structures/:id', requireWrite('payments'), wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const result = await db.query('DELETE FROM fee_structures WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, req.tenantId]);
  if (!result.rowCount) throw new HttpError(404, 'Frais introuvable.');
  await audit(req, { action: 'fee_structure.delete', entity: 'fee_structure', entityId: id });
  res.json({ ok: true });
}));

// ---------- Factures ----------

const INVOICE_SELECT = `i.id, i.invoice_number, i.student_id, s.first_name || ' ' || s.last_name AS student_name,
  i.issued_on::text AS issued_on, i.due_on::text AS due_on, i.total::float8 AS total, i.status, i.note,
  COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id), 0)::float8 AS paid,
  (i.total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id), 0))::float8 AS balance`;

router.get('/', wrap(async (req, res) => {
  const where = ['i.tenant_id = $1'];
  const params = [req.tenantId];
  if (req.query.student_id) {
    params.push(parseId(req.query.student_id));
    where.push(`i.student_id = $${params.length}`);
  }
  if (req.query.status) {
    if (!['emise', 'annulee'].includes(req.query.status)) throw new HttpError(400, 'Statut invalide.');
    params.push(req.query.status);
    where.push(`i.status = $${params.length}`);
  }
  const { limit, offset } = pageParams(req.query);
  const from = `student_invoices i JOIN students s ON s.id = i.student_id AND s.tenant_id = i.tenant_id`;
  const whereSql = where.join(' AND ');
  const [rows, count] = await Promise.all([
    db.query(`SELECT ${INVOICE_SELECT} FROM ${from} WHERE ${whereSql}
              ORDER BY i.issued_on DESC, i.invoice_number DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]),
    db.query(`SELECT COUNT(*)::int AS total FROM ${from} WHERE ${whereSql}`, params)
  ]);
  res.json({ data: rows.rows, meta: { total: count.rows[0].total, limit, offset } });
}));

// Paiements encaissés de l'élève qui ont encore un solde non affecté.
router.get('/allocatable-payments', wrap(async (req, res) => {
  const studentId = parseId(req.query.student_id || '');
  const rows = await db.query(
    `SELECT p.id, p.receipt_number, p.paid_at, p.amount::float8 AS amount,
            (p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0))::float8 AS remaining
     FROM payments p
     WHERE p.tenant_id = $1 AND p.student_id = $2 AND p.status = 'paye'
       AND p.amount > COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)
     ORDER BY p.paid_at`,
    [req.tenantId, studentId]
  );
  res.json({ data: rows.rows });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const head = await db.query(
    `SELECT ${INVOICE_SELECT} FROM student_invoices i JOIN students s ON s.id = i.student_id AND s.tenant_id = i.tenant_id
     WHERE i.id = $1 AND i.tenant_id = $2`,
    [id, req.tenantId]
  );
  if (!head.rows.length) throw new HttpError(404, 'Facture introuvable.');
  const [items, allocations] = await Promise.all([
    db.query(`SELECT label, quantity, unit_amount::float8 AS unit_amount, amount::float8 AS amount
              FROM invoice_items WHERE invoice_id = $1 ORDER BY position, label`, [id]),
    db.query(`SELECT a.id, a.payment_id, p.receipt_number, p.paid_at, a.amount::float8 AS amount
              FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
              WHERE a.invoice_id = $1 ORDER BY p.paid_at`, [id])
  ]);
  res.json({ ...head.rows[0], items: items.rows, allocations: allocations.rows });
}));

const INVOICE_FIELDS = {
  student_id: { type: 'uuid', required: true },
  due_on: { type: 'date', nullable: true },
  note: { type: 'text', max: 500, nullable: true }
};

function checkItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: { field: 'items', message: 'Ajoutez au moins une ligne.' } };
  if (raw.length > 30) return { error: { field: 'items', message: '30 lignes maximum.' } };
  const out = [];
  for (const [index, line] of raw.entries()) {
    const label = typeof line?.label === 'string' ? line.label.trim() : '';
    const quantity = Number(line?.quantity ?? 1);
    const unit = Number(line?.unit_amount);
    if (!label || label.length > 160) return { error: { field: 'items', message: `Ligne ${index + 1} : libellé requis (160 caractères maximum).` } };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return { error: { field: 'items', message: `Ligne ${index + 1} : quantité entière entre 1 et 1000.` } };
    if (!Number.isFinite(unit) || unit < 0 || unit > 10000000) return { error: { field: 'items', message: `Ligne ${index + 1} : montant unitaire invalide.` } };
    out.push({ label, quantity, unit_cents: toCents(unit) });
  }
  return { value: out };
}

async function nextInvoiceNumber(client, tenantId) {
  const counter = await client.query(
    `INSERT INTO tenant_counters (tenant_id, name, value) VALUES ($1, 'invoice', 1)
     ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
     RETURNING value`,
    [tenantId]
  );
  return `FAC-${String(Number(counter.rows[0].value)).padStart(6, '0')}`;
}

router.post('/', requireWrite('payments'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, INVOICE_FIELDS);
  const lines = checkItems(req.body?.items);
  if (lines.error) errors.push(lines.error);
  if (errors.length) return invalid(res, errors);

  const created = await db.withTransaction(async (client) => {
    const student = await client.query('SELECT id FROM students WHERE id = $1 AND tenant_id = $2', [values.student_id, req.tenantId]);
    if (!student.rowCount) throw new HttpError(422, 'Élève introuvable dans cet établissement.');
    const number = await nextInvoiceNumber(client, req.tenantId);
    const totalCents = lines.value.reduce((sum, l) => sum + l.quantity * l.unit_cents, 0);
    if (totalCents > 1000000000 * 100) throw new HttpError(400, 'Total de la facture trop élevé.');
    const invoice = await client.query(
      `INSERT INTO student_invoices (tenant_id, student_id, invoice_number, due_on, total, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, invoice_number`,
      [req.tenantId, values.student_id, number, values.due_on || null, fromCents(totalCents), values.note || null]
    );
    const invoiceId = invoice.rows[0].id;
    for (const [position, l] of lines.value.entries()) {
      await client.query(
        `INSERT INTO invoice_items (tenant_id, invoice_id, label, quantity, unit_amount, amount, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.tenantId, invoiceId, l.label, l.quantity, fromCents(l.unit_cents), fromCents(l.quantity * l.unit_cents), position]
      );
    }
    return invoice.rows[0];
  });
  await audit(req, { action: 'invoice.create', entity: 'invoice', entityId: created.id, details: { number: created.invoice_number, lines: lines.value.length } });
  res.status(201).json(created);
}));

// Affectation d'une partie d'un paiement à une facture (même élève, verrous de ligne, pas de sur-affectation).
router.post('/:id/allocations', requireWrite('payments'), wrap(async (req, res) => {
  const invoiceId = parseId(req.params.id);
  const paymentId = parseId(req.body?.payment_id || '');
  const cents = toCents(req.body?.amount);
  if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, 'Montant à affecter invalide.', { errors: [{ field: 'amount', message: 'Montant strictement positif requis.' }] });

  const result = await db.withTransaction(async (client) => {
    const inv = await client.query(
      `SELECT id, student_id, status, total::text AS total FROM student_invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [invoiceId, req.tenantId]
    );
    if (!inv.rowCount) throw new HttpError(404, 'Facture introuvable.');
    if (inv.rows[0].status !== 'emise') throw new HttpError(409, 'Cette facture est annulée.');
    const pay = await client.query(
      `SELECT id, student_id, status, amount::text AS amount FROM payments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [paymentId, req.tenantId]
    );
    if (!pay.rowCount) throw new HttpError(404, 'Paiement introuvable.');
    if (pay.rows[0].status !== 'paye') throw new HttpError(409, 'Seul un paiement encaissé peut être affecté.');
    if (pay.rows[0].student_id !== inv.rows[0].student_id) throw new HttpError(422, 'Le paiement et la facture concernent deux élèves différents.');

    const invPaid = await client.query('SELECT COALESCE(SUM(amount), 0)::text AS s FROM payment_allocations WHERE invoice_id = $1', [invoiceId]);
    const payPaid = await client.query('SELECT COALESCE(SUM(amount), 0)::text AS s FROM payment_allocations WHERE payment_id = $1', [paymentId]);
    const invBalance = toCents(inv.rows[0].total) - toCents(invPaid.rows[0].s);
    const payRemaining = toCents(pay.rows[0].amount) - toCents(payPaid.rows[0].s);
    if (payRemaining <= 0) throw new HttpError(409, 'Ce paiement est entièrement affecté.');
    if (invBalance <= 0) throw new HttpError(409, 'Cette facture est déjà soldée.');
    if (cents > invBalance) throw new HttpError(422, `Montant supérieur au solde de la facture (${fromCents(invBalance)} F CFA).`);
    if (cents > payRemaining) throw new HttpError(422, `Montant supérieur au solde disponible du paiement (${fromCents(payRemaining)} F CFA).`);

    const inserted = await client.query(
      `INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.tenantId, paymentId, invoiceId, fromCents(cents)]
    );
    return inserted.rows[0];
  });
  await audit(req, { action: 'invoice.allocate', entity: 'invoice', entityId: invoiceId, details: { payment_id: paymentId, amount: fromCents(cents) } });
  res.status(201).json(result);
}));

router.delete('/:id/allocations/:allocationId', requireWrite('payments'), wrap(async (req, res) => {
  const invoiceId = parseId(req.params.id);
  const allocationId = parseId(req.params.allocationId);
  const result = await db.withTransaction(async (client) => {
    const inv = await client.query('SELECT status FROM student_invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [invoiceId, req.tenantId]);
    if (!inv.rowCount) throw new HttpError(404, 'Facture introuvable.');
    if (inv.rows[0].status !== 'emise') throw new HttpError(409, 'Cette facture est annulée.');
    return client.query('DELETE FROM payment_allocations WHERE id = $1 AND invoice_id = $2 AND tenant_id = $3 RETURNING id', [allocationId, invoiceId, req.tenantId]);
  });
  if (!result.rowCount) throw new HttpError(404, 'Affectation introuvable.');
  await audit(req, { action: 'invoice.unallocate', entity: 'invoice', entityId: invoiceId, details: { allocation_id: allocationId } });
  res.json({ ok: true });
}));

// Annulation : la facture reste visible (statut « annulee ») et ses affectations sont libérées.
router.post('/:id/cancel', requireWrite('payments'), wrap(async (req, res) => {
  const invoiceId = parseId(req.params.id);
  const released = await db.withTransaction(async (client) => {
    const inv = await client.query('SELECT status FROM student_invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [invoiceId, req.tenantId]);
    if (!inv.rowCount) throw new HttpError(404, 'Facture introuvable.');
    if (inv.rows[0].status === 'annulee') throw new HttpError(409, 'Cette facture est déjà annulée.');
    const freed = await client.query(
      'DELETE FROM payment_allocations WHERE invoice_id = $1 AND tenant_id = $2 RETURNING amount::text AS amount', [invoiceId, req.tenantId]
    );
    await client.query(`UPDATE student_invoices SET status = 'annulee', updated_at = now() WHERE id = $1`, [invoiceId]);
    return freed.rows.reduce((sum, r) => sum + toCents(r.amount), 0);
  });
  await audit(req, { action: 'invoice.cancel', entity: 'invoice', entityId: invoiceId, details: { released: fromCents(released) } });
  res.json({ ok: true, released: fromCents(released) });
}));

// Facture PDF (lecture : droit « Paiements »).
router.get('/:id/invoice.pdf', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const x = await loadFamilyInvoice(req.tenantId, id);
  if (!x) throw new HttpError(404, 'Facture introuvable.');
  sendPdf(res, renderFamilyInvoice(x), invoiceFilename(x));
}));

// Envoi de la facture PDF aux responsables de l'élève ayant une adresse e-mail (file d'envoi « mail_outbox »).
router.post('/:id/send', requireWrite('payments'), wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const x = await loadFamilyInvoice(req.tenantId, id);
  if (!x) throw new HttpError(404, 'Facture introuvable.');
  if (x.status !== 'emise') throw new HttpError(409, 'Une facture annulée ne peut pas être envoyée.');
  const to = await invoiceRecipients(req.tenantId, x.student_id);
  if (!to.length) throw new HttpError(422, 'Aucun responsable de cet élève n’a d’adresse e-mail. Renseignez-la dans la fiche du responsable.');
  const mail = invoiceEmail(x);
  const attachments = [{ filename: invoiceFilename(x), contentType: 'application/pdf', content: renderFamilyInvoice(x) }];
  const results = [];
  for (const email of to) {
    const r = await deliver({ tenantId: req.tenantId, to: email, subject: mail.subject, text: mail.text, html: mail.html, kind: 'family_invoice', ref: id, attachments });
    results.push({ to: email, status: r.status, error: r.error || null });
  }
  await audit(req, { action: 'invoice.send', entity: 'invoice', entityId: id, details: { recipients: to.length, statuses: results.map((r) => r.status) } });
  res.json({ data: results });
}));

module.exports = router;
