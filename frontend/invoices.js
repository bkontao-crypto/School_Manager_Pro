// Module Factures familiales (Finances) : liste, grilles de frais, création de facture, détail,
// affectation d'un paiement encaissé, retrait d'une affectation, annulation.
// S'appuie sur les helpers de app.js (api, get, rows, permOf, openModal, closeModal, hydrateFormWidgets, confirmDialog…).

const INV_PAGE = 50;
const invState = { offset: 0, status: '' };
const invCanEdit = () => permOf('payments') === 'write';

function invBadge(inv) {
  let text = 'Impayée'; let cls = 'bg-red-100 text-red-700';
  if (inv.status === 'annulee') { text = 'Annulée'; cls = 'bg-slate-200 text-slate-700'; }
  else if (Number(inv.balance) <= 0) { text = 'Soldée'; cls = 'bg-emerald-100 text-emerald-800'; }
  else if (Number(inv.paid) > 0) { text = 'Partielle'; cls = 'bg-amber-100 text-amber-800'; }
  return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}">${text}</span>`;
}
const invDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR') : '—');
const invMoney = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n || 0))} F`;
const TH = 'py-3 px-3 first:pl-4';
const THEAD = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border-y border-slate-200';

async function openInvoices() {
  const canEdit = invCanEdit();
  moduleView.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3">
    <div><p class="text-sm text-slate-500">Finances</p><h2 class="text-2xl font-bold text-ink">Factures familiales</h2></div>
    <div class="flex flex-wrap gap-2">
      <select id="inv-status" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Filtrer par statut">
        <option value="">Toutes les factures</option><option value="emise">Émises</option><option value="annulee">Annulées</option></select>
      ${canEdit ? '<button id="inv-fees" type="button" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold"><i class="fa-solid fa-list mr-2"></i>Grilles de frais</button>' : ''}
      ${canEdit ? '<button id="inv-new" type="button" class="px-4 py-2 rounded-xl bg-royal-600 hover:bg-royal-500 text-white text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>Nouvelle facture</button>' : ''}
    </div></div>
    <section class="panel p-5 mt-5">
      <div class="flex justify-between items-center mb-4"><h3 class="font-bold text-ink">Liste</h3><span id="inv-count" class="text-xs text-slate-500">Chargement…</span></div>
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="${THEAD}">
        <th class="${TH}">Numéro</th><th class="${TH}">Élève</th><th class="${TH}">Émise le</th><th class="${TH}">Total</th><th class="${TH}">Payé</th><th class="${TH}">Solde</th><th class="${TH}">Statut</th><th class="py-3 px-3"></th>
      </tr></thead><tbody id="inv-rows"></tbody></table></div>
      <div class="flex items-center justify-between mt-4"><button id="inv-prev" type="button" class="text-sm text-blue-600 disabled:text-slate-300">← Précédent</button><span id="inv-page" class="text-xs text-slate-500"></span><button id="inv-next" type="button" class="text-sm text-blue-600 disabled:text-slate-300">Suivant →</button></div>
      <p id="inv-error" class="text-sm text-red-600 mt-3" role="alert"></p>
    </section>`;
  invState.offset = 0;
  $('inv-status').value = invState.status;
  $('inv-status').addEventListener('change', (e) => { invState.status = e.target.value; invState.offset = 0; loadInvoices(); });
  $('inv-prev').addEventListener('click', () => { invState.offset = Math.max(0, invState.offset - INV_PAGE); loadInvoices(); });
  $('inv-next').addEventListener('click', () => { invState.offset += INV_PAGE; loadInvoices(); });
  if (canEdit) {
    $('inv-new').addEventListener('click', () => openInvoiceForm());
    $('inv-fees').addEventListener('click', () => openFeeStructures());
  }
  $('inv-rows').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-inv]'); if (btn) openInvoiceDetail(btn.dataset.inv);
  });
  await loadInvoices();
}

async function loadInvoices() {
  const tbody = $('inv-rows'), count = $('inv-count'), err = $('inv-error');
  if (!tbody) return;
  err.textContent = '';
  tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-slate-400">Chargement…</td></tr>';
  const qs = new URLSearchParams({ limit: String(INV_PAGE), offset: String(invState.offset) });
  if (invState.status) qs.set('status', invState.status);
  try {
    const res = await get(`/api/invoices?${qs}`);
    const data = rows(res), total = res.meta ? res.meta.total : data.length;
    count.textContent = `${new Intl.NumberFormat('fr-FR').format(total)} facture(s)`;
    $('inv-page').textContent = total ? `${invState.offset + 1}–${invState.offset + data.length} sur ${total}` : '';
    $('inv-prev').disabled = invState.offset === 0;
    $('inv-next').disabled = invState.offset + data.length >= total;
    tbody.innerHTML = data.length ? data.map((inv) => `<tr class="border-b border-slate-100 hover:bg-slate-50/70">
      <td class="py-3 px-3 first:pl-4 font-semibold text-ink whitespace-nowrap">${escapeHtml(inv.invoice_number)}</td>
      <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${escapeHtml(inv.student_name)}</td>
      <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${invDate(inv.issued_on)}</td>
      <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${invMoney(inv.total)}</td>
      <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${invMoney(inv.paid)}</td>
      <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${invMoney(inv.balance)}</td>
      <td class="py-3 px-3 whitespace-nowrap">${invBadge(inv)}</td>
      <td class="py-3 px-3 whitespace-nowrap text-right"><button type="button" data-inv="${escapeHtml(inv.id)}" class="text-emerald-700 hover:underline font-semibold">Détail</button></td>
    </tr>`).join('') : '<tr><td colspan="8" class="py-8 text-center text-slate-400">Aucune facture.</td></tr>';
  } catch (e) {
    tbody.innerHTML = ''; count.textContent = ''; err.textContent = e.message;
  }
}

// ---------- Grilles de frais ----------

async function openFeeStructures() {
  const paint = async (message = '') => {
    const list = rows(await get('/api/invoices/fee-structures'));
    $('modal-box').innerHTML = `<h3 class="text-lg font-bold text-ink">Grilles de frais</h3>
      <p class="text-sm text-slate-500 mt-1">Frais réutilisables lors de la création d’une facture.</p>
      <div class="mt-4 divide-y divide-slate-100 border border-slate-200 rounded-lg">
        ${list.length ? list.map((f) => `<div class="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span class="text-slate-700">${escapeHtml(f.label)}</span><span class="flex items-center gap-3 whitespace-nowrap"><span class="font-semibold text-ink">${invMoney(f.amount)}</span><button type="button" data-fee-del="${escapeHtml(f.id)}" class="text-red-600 hover:underline text-xs font-semibold">Supprimer</button></span></div>`).join('') : '<p class="px-3 py-3 text-sm text-slate-500">Aucun frais enregistré.</p>'}
      </div>
      <form id="fee-form" class="mt-4 space-y-3" novalidate>
        <label class="block text-xs font-semibold text-slate-600">Libellé *<input name="label" maxlength="120" class="${INPUT_CLS}"></label>
        <div class="flex gap-2 items-end"><label class="block flex-1 text-xs font-semibold text-slate-600">Montant (F CFA) *<input name="amount" inputmode="decimal" class="${INPUT_CLS}"></label>
        <button type="submit" class="px-4 py-2 rounded-lg bg-royal-600 text-white text-sm font-semibold">Ajouter</button></div></form>
      <p id="fee-msg" class="text-sm mt-3 ${message ? 'text-emerald-700' : 'text-red-600'}" role="alert">${escapeHtml(message)}</p>
      <div class="mt-5 flex justify-end"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Fermer</button></div>`;
    $('modal-box').querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(true));
    $('fee-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try {
        await api('POST', '/api/invoices/fee-structures', { label: f.label.value, amount: f.amount.value.replace(',', '.') });
        await paint('Frais ajouté.');
      } catch (e) { $('fee-msg').textContent = e.message; }
    });
    $('modal-box').querySelectorAll('[data-fee-del]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/invoices/fee-structures/${encodeURIComponent(b.dataset.feeDel)}`); await paint('Frais supprimé.'); } catch (e) { $('fee-msg').textContent = e.message; }
    }));
  };
  openModal('<p class="text-sm text-slate-500">Chargement…</p>');
  await paint();
}

// ---------- Création de facture ----------

async function openInvoiceForm() {
  const fees = rows(await get('/api/invoices/fee-structures'));
  const lineHtml = (i) => `<div data-line class="grid grid-cols-1 sm:grid-cols-[1fr_5rem_8rem_auto] gap-2 items-end">
      <label class="block text-xs font-semibold text-slate-600">Libellé *<input data-l-label maxlength="160" class="${INPUT_CLS}"></label>
      <label class="block text-xs font-semibold text-slate-600">Qté<input data-l-qty value="1" inputmode="numeric" class="${INPUT_CLS}"></label>
      <label class="block text-xs font-semibold text-slate-600">Montant unitaire (F)<input data-l-unit inputmode="decimal" class="${INPUT_CLS}"></label>
      <button type="button" data-l-del class="pb-2 text-red-600 text-xs font-semibold hover:underline">Retirer</button>
      ${fees.length ? `<select data-l-fee class="sm:col-span-4 ${INPUT_CLS} text-xs"><option value="">Choisir un frais de la grille…</option>${fees.map((f) => `<option value="${escapeHtml(f.id)}" data-amount="${escapeHtml(f.amount)}" data-label="${escapeHtml(f.label)}">${escapeHtml(f.label)} — ${invMoney(f.amount)}</option>`).join('')}</select>` : ''}
    </div>`;
  openModal(`<h3 class="text-lg font-bold text-ink">Nouvelle facture familiale</h3>
    <form id="inv-form" class="mt-4 space-y-4" novalidate>
      <div><span class="block text-xs font-semibold text-slate-600">Élève *</span>
        <span class="relative block mt-1" data-student-picker>
          <input type="search" data-student-search placeholder="Tapez un nom ou un matricule…" autocomplete="off" class="${INPUT_CLS} mt-0">
          <input type="hidden" data-student-value>
          <span data-student-results class="hidden absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1 block"></span>
          <span data-student-status class="block mt-1 text-xs font-normal text-slate-500">Saisissez au moins 2 caractères.</span>
        </span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block text-xs font-semibold text-slate-600">Échéance<input name="due_on" type="date" class="${INPUT_CLS}"></label>
        <label class="block text-xs font-semibold text-slate-600">Note<input name="note" maxlength="500" class="${INPUT_CLS}"></label>
      </div>
      <div><p class="text-xs font-semibold text-slate-600 mb-2">Lignes de facture *</p>
        <div id="inv-lines" class="space-y-3">${lineHtml(0)}</div>
        <button type="button" id="inv-add-line" class="mt-3 text-sm text-royal-600 font-semibold hover:underline"><i class="fa-solid fa-plus mr-1"></i>Ajouter une ligne</button></div>
      <p class="text-right text-sm text-slate-600">Total : <strong id="inv-total" class="text-ink">0 F</strong></p>
      <p id="inv-form-error" class="text-sm text-red-600" role="alert"></p>
      <div class="flex justify-end gap-2"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Annuler</button>
        <button type="submit" class="px-4 py-2 rounded-lg bg-royal-600 text-white text-sm font-semibold">Créer la facture</button></div>
    </form>`);
  const box = $('modal-box');
  box.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(null));
  await hydrateFormWidgets(box);
  const lines = () => [...box.querySelectorAll('[data-line]')];
  const recalc = () => {
    const total = lines().reduce((s, l) => s + (Number(String(l.querySelector('[data-l-qty]').value).replace(',', '.')) || 0) * (Number(String(l.querySelector('[data-l-unit]').value).replace(',', '.')) || 0), 0);
    $('inv-total').textContent = invMoney(total);
  };
  const bindLine = (l) => {
    l.addEventListener('input', recalc);
    const fee = l.querySelector('[data-l-fee]');
    if (fee) fee.addEventListener('change', () => {
      const o = fee.selectedOptions[0];
      if (!o || !o.value) return;
      l.querySelector('[data-l-label]').value = o.dataset.label;
      l.querySelector('[data-l-unit]').value = o.dataset.amount;
      recalc();
    });
    l.querySelector('[data-l-del]').addEventListener('click', () => {
      if (lines().length > 1) { l.remove(); recalc(); }
    });
  };
  lines().forEach(bindLine);
  $('inv-add-line').addEventListener('click', () => {
    if (lines().length >= 30) { $('inv-form-error').textContent = '30 lignes maximum.'; return; }
    const wrap = document.createElement('div');
    wrap.innerHTML = lineHtml(lines().length);
    const l = wrap.firstElementChild;
    $('inv-lines').appendChild(l); bindLine(l); recalc();
  });
  $('inv-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('inv-form-error'); err.textContent = '';
    const student_id = box.querySelector('[data-student-value]').value;
    if (!student_id) { err.textContent = 'Choisissez un élève dans la liste.'; return; }
    const items = lines().map((l) => ({
      label: l.querySelector('[data-l-label]').value.trim(),
      quantity: l.querySelector('[data-l-qty]').value.trim() || '1',
      unit_amount: l.querySelector('[data-l-unit]').value.trim().replace(',', '.')
    }));
    const form = ev.target;
    try {
      const inv = await api('POST', '/api/invoices', { student_id, due_on: form.due_on.value || null, note: form.note.value || null, items });
      closeModal(true);
      toast(`Facture ${inv.invoice_number} créée.`);
      await loadInvoices();
      openInvoiceDetail(inv.id);
    } catch (e) { err.textContent = e.message; }
  });
}

// ---------- Détail, affectation, retrait, annulation ----------

async function openInvoiceDetail(id) {
  const inv = await get(`/api/invoices/${encodeURIComponent(id)}`);
  const canEdit = invCanEdit();
  const emise = inv.status === 'emise';
  const open = emise && Number(inv.balance) > 0;
  const avail = canEdit && open ? rows(await get(`/api/invoices/allocatable-payments?student_id=${encodeURIComponent(inv.student_id)}`)) : [];
  const amt = (n) => String(Math.round(Number(n) * 100) / 100);
  const suggested = (p) => amt(Math.min(Number(inv.balance), Number(p.remaining)));
  openModal(`<div class="flex flex-wrap items-start justify-between gap-3">
      <div><p class="text-xs text-slate-500">Facture</p><h3 class="text-lg font-bold text-ink">${escapeHtml(inv.invoice_number)}</h3>
        <p class="text-sm text-slate-600">${escapeHtml(inv.student_name)} · émise le ${invDate(inv.issued_on)}${inv.due_on ? ` · échéance ${invDate(inv.due_on)}` : ''}</p></div>
      ${invBadge(inv)}</div>
    ${inv.note ? `<p class="text-sm text-slate-500 mt-2">${escapeHtml(inv.note)}</p>` : ''}
    <div class="overflow-x-auto mt-4 border border-slate-200 rounded-lg"><table class="w-full text-sm text-left"><thead><tr class="${THEAD}"><th class="${TH}">Désignation</th><th class="${TH}">Qté</th><th class="${TH}">Unitaire</th><th class="${TH}">Montant</th></tr></thead>
      <tbody>${inv.items.map((it) => `<tr class="border-b border-slate-100"><td class="py-2.5 px-3 first:pl-4 text-slate-700">${escapeHtml(it.label)}</td><td class="py-2.5 px-3">${it.quantity}</td><td class="py-2.5 px-3 whitespace-nowrap">${invMoney(it.unit_amount)}</td><td class="py-2.5 px-3 whitespace-nowrap font-semibold">${invMoney(it.amount)}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
      <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Total</p><p class="font-bold text-ink">${invMoney(inv.total)}</p></div>
      <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Payé</p><p class="font-bold text-ink">${invMoney(inv.paid)}</p></div>
      <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Solde</p><p class="font-bold text-ink">${invMoney(inv.balance)}</p></div>
    </div>
    <h4 class="font-semibold text-ink mt-5 mb-2">Paiements affectés</h4>
    ${inv.allocations.length ? `<ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg">${inv.allocations.map((a) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <span class="text-slate-700">Reçu ${escapeHtml(a.receipt_number)} · ${new Date(a.paid_at).toLocaleDateString('fr-FR')}</span>
        <span class="flex items-center gap-3 whitespace-nowrap"><span class="font-semibold">${invMoney(a.amount)}</span>
        ${canEdit && emise ? `<button type="button" data-unalloc="${escapeHtml(a.id)}" class="text-red-600 hover:underline text-xs font-semibold">Retirer</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="text-sm text-slate-500">Aucun paiement affecté.</p>'}
    ${open && canEdit ? (avail.length ? `<form id="alloc-form" class="mt-4 space-y-3" novalidate>
        <label class="block text-xs font-semibold text-slate-600">Paiement encaissé<select name="payment_id" class="${INPUT_CLS}">${avail.map((p) => `<option value="${escapeHtml(p.id)}" data-remaining="${escapeHtml(p.remaining)}">Reçu ${escapeHtml(p.receipt_number)} — reste ${invMoney(p.remaining)}</option>`).join('')}</select></label>
        <div class="flex gap-2 items-end"><label class="block flex-1 text-xs font-semibold text-slate-600">Montant (F)<input name="amount" inputmode="decimal" value="${suggested(avail[0])}" class="${INPUT_CLS}"></label>
        <button type="submit" class="px-4 py-2 rounded-lg bg-royal-600 text-white text-sm font-semibold">Affecter</button></div></form>` : '<p class="text-sm text-slate-500 mt-4">Aucun paiement encaissé disponible pour cet élève.</p>') : ''}
    ${canEdit && emise ? '<div class="mt-5 pt-4 border-t border-slate-100 text-right"><button type="button" id="inv-cancel" class="text-sm font-semibold text-red-600 hover:underline">Annuler la facture</button></div>' : ''}
    <p id="inv-detail-msg" class="text-sm mt-3 text-red-600" role="alert"></p>
    <div class="mt-4 flex justify-end"><button type="button" data-modal-cancel class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Fermer</button></div>`);
  const box = $('modal-box');
  const msg = $('inv-detail-msg');
  const reload = async () => { await loadInvoices(); openInvoiceDetail(id); };
  box.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(null));
  const alloc = $('alloc-form');
  if (alloc) {
    const sel = alloc.payment_id;
    sel.addEventListener('change', () => { alloc.amount.value = amt(Math.min(Number(inv.balance), Number(sel.selectedOptions[0].dataset.remaining))); });
    alloc.addEventListener('submit', async (ev) => {
      ev.preventDefault(); msg.textContent = '';
      try {
        await api('POST', `/api/invoices/${encodeURIComponent(id)}/allocations`, { payment_id: sel.value, amount: alloc.amount.value.replace(',', '.') });
        toast('Paiement affecté.');
        await reload();
      } catch (e) { msg.textContent = e.message; }
    });
  }
  box.querySelectorAll('[data-unalloc]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Retirer ce paiement', 'Le montant redeviendra disponible sur le paiement.'))) return;
    try { await api('DELETE', `/api/invoices/${encodeURIComponent(id)}/allocations/${encodeURIComponent(b.dataset.unalloc)}`); toast('Affectation retirée.'); await reload(); } catch (e) { msg.textContent = e.message; }
  }));
  const cancelBtn = $('inv-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('Annuler la facture', 'La facture reste consultable, marquée « Annulée ». Les paiements qui lui étaient affectés redeviennent disponibles.'))) return;
    try {
      const r = await api('POST', `/api/invoices/${encodeURIComponent(id)}/cancel`);
      toast(`Facture annulée. ${invMoney(r.released)} libéré(s).`);
      await reload();
    } catch (e) { msg.textContent = e.message; }
  });
}
