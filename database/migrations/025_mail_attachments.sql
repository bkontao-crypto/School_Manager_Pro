-- 025 : e-mails avec pièce jointe. La pièce jointe n'est pas stockée : on mémorise sa nature (facture) pour la régénérer lors d'un nouvel essai.
ALTER TABLE mail_outbox
  ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS invoice_id      UUID;
