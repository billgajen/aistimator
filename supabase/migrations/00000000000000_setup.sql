-- Initial migration placeholder
-- This migration sets up prerequisites for the Estimator platform
-- Full schema will be implemented in T-005

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom types (enums)
-- These will be used across multiple tables

-- Service area restriction modes
CREATE TYPE service_area_mode AS ENUM (
  'none',
  'postcode_allowlist',
  'county_state'
);

-- Document types for quotes
CREATE TYPE document_type AS ENUM (
  'instant_estimate',
  'formal_quote',
  'proposal',
  'sow'
);

-- Quote status workflow
CREATE TYPE quote_status AS ENUM (
  'queued',
  'generating',
  'sent',
  'viewed',
  'accepted',
  'paid',
  'expired',
  'failed'
);

-- Asset types
CREATE TYPE asset_type AS ENUM (
  'image',
  'document',
  'pdf'
);

-- Subscription status
CREATE TYPE subscription_status AS ENUM (
  'active',
  'past_due',
  'canceled',
  'trialing'
);

-- Helper function to generate prefixed IDs
-- Usage: generate_prefixed_id('tnt') -> 'tnt_abc123xyz'
CREATE OR REPLACE FUNCTION generate_prefixed_id(prefix TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN prefix || '_' || encode(gen_random_bytes(12), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comment for documentation
COMMENT ON FUNCTION generate_prefixed_id IS 'Generates a prefixed ID like tnt_abc123 for readable, stable identifiers';
COMMENT ON FUNCTION update_updated_at_column IS 'Trigger function to auto-update updated_at timestamp';
