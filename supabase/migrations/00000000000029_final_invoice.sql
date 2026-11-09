-- T-143: beta instrumentation. The business records what it finally invoiced
-- for a job, so estimate accuracy can be measured per trade
-- (Docs/09 success metric: median |final invoice − quoted| / quoted < 10%).
-- Additive and nullable: existing quotes are untouched; re-runnable.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_invoice_amount NUMERIC(12, 2)
  CHECK (final_invoice_amount IS NULL OR final_invoice_amount >= 0);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_invoice_recorded_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_invoice_note TEXT
  CHECK (final_invoice_note IS NULL OR char_length(final_invoice_note) <= 500);

-- The accuracy report reads only quotes with a recorded invoice
CREATE INDEX IF NOT EXISTS quotes_final_invoice_idx
  ON quotes (tenant_id, final_invoice_recorded_at)
  WHERE final_invoice_amount IS NOT NULL;
