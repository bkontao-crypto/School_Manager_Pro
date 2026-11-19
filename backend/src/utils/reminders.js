// Rappels automatiques par e-mail : fin de licence (J-30, J-15, J-7, jour J / expirée) et factures impayées
// (J+3, J+10, J+17). Chaque rappel n'est envoyé qu'une fois (table notification_log). Sans SMTP configuré, rien n'est
// envoyé ni consommé : les rappels partiront dès que la configuration sera faite.

const db = require('./db');
const { mailConfig, deliver, htmlLayout } = require('./mailer');
const { licenseState, today } = require('./license');

const LICENSE_STEPS = [30, 15, 7, 0];
const INVOICE_STEPS = [3, 10, 17];
const MAX_FAILED_ATTEMPTS = 3;
const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const fmtDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtMoney = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)))} F CFA`;

// Destinataires d'un établissement : e-mail de contact, sinon administrateurs actifs.
async function tenantRecipients(tenantId) {
  const t = await db.query('SELECT contact_email FROM tenants WHERE id = $1', [tenantId]);
  if (t.rows[0] && t.rows[0].contact_email) return [t.rows[0].contact_email];
  const a = await db.query(`SELECT email FROM users WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE ORDER BY created_at LIMIT 3`, [tenantId]);
  return a.rows.map((r) => r.email);
}

async function platformIssuer() {
  const r = await db.query('SELECT app_name FROM platform_identity');
  return (r.rows[0] && r.rows[0].app_name) || 'SCHOOL MANAGER PRO';
}

function licenseMail(t, step, daysLeft, issuer, appUrl) {
  const expired = daysLeft < 0;
  const subject = expired ? `Licence expirée — ${t.name}` : (daysLeft === 0 ? `Votre licence expire aujourd’hui — ${t.name}` : `Votre licence expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — ${t.name}`);
  const intro = expired
    ? `La licence de ${t.name} a expiré le ${fmtDate(t.license_end)}. L’accès est suspendu jusqu’au renouvellement ; vos données sont conservées.`
    : `La licence de ${t.name} arrive à échéance le ${fmtDate(t.license_end)}. Pensez à la renouveler pour éviter toute interruption d’accès.`;
  const text = `${intro}\n\nPour renouveler, contactez ${issuer}.\n`;
  return { subject, text, html: htmlLayout({ title: subject, intro, rows: [['Établissement', t.name], ['Fin de licence', fmtDate(t.license_end)]], footer: `Message automatique de ${issuer}.`, button: appUrl ? { url: appUrl, label: 'Ouvrir l’application' } : undefined }) };
}

function invoiceReminderMail(inv, step, issuer) {
  const late = days(today(), inv.due_date);
  const subject = `Rappel : facture ${inv.number} impayée (${late} jours de retard)`;
  const intro = `Sauf erreur de notre part, la facture ${inv.number} de ${fmtMoney(inv.due)} est échue depuis le ${fmtDate(inv.due_date)}.\nMerci de procéder au règlement ou de nous contacter si celui-ci a déjà été effectué.`;
  return { subject, text: `${intro}\n\n${issuer}\n`, html: htmlLayout({ title: subject, intro, rows: [['Facture', inv.number], ['Montant dû', fmtMoney(inv.due)], ['Échéance', fmtDate(inv.due_date)]], footer: `Message automatique de ${issuer}.` }) };
}

// Calcule (et envoie sauf dryRun) les rappels dus. Retourne le détail pour affichage dans l'écran superadmin.
async function runReminders({ now = today(), dryRun = false } = {}) {
  const cfg = mailConfig();
  const out = { mail_configured: cfg.configured, dry_run: dryRun, due: [], sent: 0, failed: 0, skipped: 0 };
  const issuer = await platformIssuer();
  const items = [];

  const tenants = await db.query(`SELECT id, name, status, license_end FROM tenants WHERE license_end IS NOT NULL AND status <> 'suspended'`);
  for (const t of tenants.rows) {
    if (licenseState(t, now) === 'unlimited') continue;
    const left = days(t.license_end, now);
    const step = left < 0 ? -1 : LICENSE_STEPS.slice().reverse().find((s) => left <= s);
    if (step === undefined || left > 30) continue;
    items.push({ kind: 'license', tenantId: t.id, ref: `lic:${t.id}:${String(t.license_end).slice(0, 10)}:${step}`, label: `${t.name} — licence (${left < 0 ? 'expirée' : `J-${left}`})`, mail: licenseMail(t, step, left, issuer, cfg.appUrl) });
  }

  const invs = await db.query(
    `SELECT i.id, i.number, i.tenant_id, i.due_date, (i.amount - COALESCE((SELECT sum(c.amount) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued'), 0))::float8 AS due, t.name
       FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.document_type = 'invoice' AND i.status = 'pending' AND i.due_date < $1::date`, [now]);
  for (const i of invs.rows) {
    if (!(i.due > 0)) continue;
    const late = days(now, String(i.due_date).slice(0, 10));
    const step = INVOICE_STEPS.slice().reverse().find((s) => late >= s);
    if (step === undefined) continue;
    items.push({ kind: 'invoice', tenantId: i.tenant_id, ref: `inv:${i.id}:${step}`, label: `${i.name} — ${i.number} (retard ${late} j)`, mail: invoiceReminderMail({ ...i, due_date: String(i.due_date).slice(0, 10) }, step, issuer) });
  }

  for (const it of items) {
    const logged = await db.query('SELECT 1 FROM notification_log WHERE kind = $1 AND ref = $2 AND tenant_id IS NOT DISTINCT FROM $3', [it.kind, it.ref, it.tenantId]);
    if (logged.rows.length) continue;
    const failures = await db.query(`SELECT count(*) AS n FROM mail_outbox WHERE ref = $1 AND status = 'failed' AND tenant_id IS NOT DISTINCT FROM $2`, [it.ref, it.tenantId]);
    if (Number(failures.rows[0].n) >= MAX_FAILED_ATTEMPTS) continue;       // abandonné après 3 échecs
    const to = await tenantRecipients(it.tenantId);
    out.due.push({ kind: it.kind, label: it.label, to });
    if (dryRun || !cfg.configured) { if (!cfg.configured) out.skipped += 1; continue; }
    if (!to.length) { out.skipped += 1; continue; }
    let ok = true;
    for (const addr of to) {
      const r = await deliver({ tenantId: it.tenantId, to: addr, subject: it.mail.subject, text: it.mail.text, html: it.mail.html, kind: `reminder_${it.kind}`, ref: it.ref });
      if (r.status !== 'sent') ok = false;
    }
    if (ok) { await db.query('INSERT INTO notification_log (kind, ref, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [it.kind, it.ref, it.tenantId]); out.sent += 1; } else out.failed += 1;
  }
  return out;
}

// Planificateur : au démarrage (après 1 minute) puis toutes les 6 heures. Les doublons sont impossibles (notification_log).
function startScheduler(log = console) {
  if (process.env.MAIL_SCHEDULER === 'false') return null;
  const run = () => runReminders().then(async (r) => { await require('./notify').runUnpaidReminders().catch((e) => log.error('[impayés]', e.message)); return r; }).then((r) => { if (r.sent || r.failed) log.log(`[rappels] envoyés : ${r.sent}, échecs : ${r.failed}`); }).catch((e) => log.error('[rappels]', e.message));
  const first = setTimeout(run, 60 * 1000); first.unref();
  const timer = setInterval(run, 6 * 3600 * 1000); timer.unref();
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { runReminders, startScheduler, tenantRecipients, fmtDate, fmtMoney };
