-- 035 — Factures familiales et affectation des paiements (additif).
-- Grilles de frais par établissement, factures par élève, lignes de facture et affectations paiement → facture.
-- Numérotation FAC-000001 par établissement (compteur tenant_counters « invoice »).

CREATE TABLE IF NOT EXISTS fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fee_structures_amount_check CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_fee_structures_tenant ON fee_structures (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS students_id_tenant_uniq ON students (id, tenant_id);

CREATE TABLE IF NOT EXISTS student_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  invoice_number VARCHAR(20) NOT NULL,
  issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on DATE,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'emise',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_invoices_student_fk FOREIGN KEY (student_id, tenant_id)
    REFERENCES students (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT student_invoices_number_uq UNIQUE (tenant_id, invoice_number),
  CONSTRAINT student_invoices_status_check CHECK (status IN ('emise', 'annulee')),
  CONSTRAINT student_invoices_total_check CHECK (total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_student_invoices_student ON student_invoices (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES student_invoices(id) ON DELETE CASCADE,
  label VARCHAR(160) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount NUMERIC(12,2) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT invoice_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT invoice_items_unit_check CHECK (unit_amount >= 0),
  CONSTRAINT invoice_items_amount_check CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

-- Une affectation rattache une partie d'un paiement encaissé à une facture du même élève.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES student_invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocations_amount_check CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations (invoice_id);
