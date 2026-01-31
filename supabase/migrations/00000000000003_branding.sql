-- Branding and Template Settings Migration
-- Adds branding configuration fields to tenants table

-- Add branding JSONB column to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{
  "logoAssetId": null,
  "primaryColor": "#2563eb",
  "footerNotes": null
}'::jsonb;

-- Add template settings JSONB column to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS template_json JSONB NOT NULL DEFAULT '{
  "showLineItems": true,
  "includeAssumptions": true,
  "includeExclusions": true,
  "validityDays": 30
}'::jsonb;

-- Comment for documentation
COMMENT ON COLUMN tenants.branding_json IS 'Branding settings: logo, colors, footer notes';
COMMENT ON COLUMN tenants.template_json IS 'Quote template settings: sections to show, validity period';
