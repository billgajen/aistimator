-- Migration: Add signal_conflicts_json column to quotes table
-- Phase 3: Signal Fusion with Provenance — records conflicts when vision and form disagree

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signal_conflicts_json JSONB;

COMMENT ON COLUMN quotes.signal_conflicts_json IS 'Signal conflicts recorded during fusion: when vision and form sources disagree on a signal value';
