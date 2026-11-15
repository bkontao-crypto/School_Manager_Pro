// Module Paiements : statuts paye / en_attente / annule ; numéro de reçu généré par le serveur, par établissement.

const { makeResource } = require('../utils/resource');
const db = require('../utils/db');
const { isUuid } = require('../utils/validate');
const { wrap, HttpError } = require('../utils/http');
const { sendPdf } = require('../utils/reportCardPdf');
const { loadReceipt, renderReceipt, receiptFilename } = require('../utils/receiptPdf');

// Le compteur et l'insertion partagent la même transaction : un échec n'« use » pas de numéro de reçu.
async function createPayment(req, values) {
  return db.withTransaction(async (client) => {
    const counter = await client.query(
      `INSERT INTO tenant_counters (tenant_id, name, value) VALUES ($1, 'receipt', 1)
       ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
       RETURNING value`,
      [req.tenantId]
    );
    const year = new Date().getFullYear();
    const receipt = `R-${year}-${String(Number(counter.rows[0].value)).padStart(6, '0')}`;
    const result = await client.query(
      `INSERT INTO payments (tenant_id, student_id, amount, fee_type, method, status, receipt_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.tenantId, values.student_id, values.amount, values.fee_type || null, values.method || null,
        values.status || 'paye', receipt]
    );
    return result.rows[0];
  });
}

const router = makeResource({
  entity: 'payment',
  table: 'payments',
  from: `payments p JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id`,
  tenantCol: 'p.tenant_id',
  select: `p.id, p.student_id, s.first_name || ' ' || s.last_name AS student_name, p.amount, p.fee_type, p.method,
           p.receipt_number, p.status, p.paid_at`,
  orderBy: 'p.paid_at DESC',
  filters: {
    student_id: { type: 'uuid', column: 'p.student_id' },
    status: { type: 'enum', values: ['paye', 'en_attente', 'annule'], column: 'p.status' }
  },
  fields: {
    student_id: { type: 'uuid', required: true },
    amount: { type: 'number', required: true, exclusiveMin: 0, max: 1000000000 },
    fee_type: { type: 'string', max: 100 },
    method: { type: 'string', max: 50 },
    status: { type: 'enum', values: ['paye', 'en_attente', 'annule'] }
  },
  module: 'payments',
  create: createPayment,
  exportCsv: { filename: 'paiements.csv', columns: [['receipt_number', 'Reçu'], ['student_name', 'Élève'], ['amount', 'Montant (F CFA)'], ['fee_type', 'Type de frais'], ['method', 'Mode'], ['status', 'Statut'], ['paid_at', 'Date']] }
});

// Reçu PDF d'un paiement encaissé (droit de lecture sur « Paiements » appliqué au montage du module).
router.get('/:id/receipt.pdf', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const x = await loadReceipt(req.tenantId, req.params.id);
  if (!x) throw new HttpError(404, 'Paiement introuvable.');
  if (x.status !== 'paye') throw new HttpError(409, 'Un reçu n’est disponible que pour un paiement encaissé.');
  sendPdf(res, renderReceipt(x), receiptFilename(x));
}));

module.exports = router;
