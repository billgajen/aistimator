-- Migration: Add triage_json column to quotes table
-- Phase 2: Triage Agent — stores classification, photo strategy, and returning customer info

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS triage_json JSONB;

COMMENT ON COLUMN quotes.triage_json IS 'Triage agent decision: classification (simple/standard/complex), photo strategy, cross-service check flag, returning customer info';
