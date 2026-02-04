-- FIX-5: Update form label for line_set_count field
-- Service: 4f2b05cb-70f1-4912-bab1-de778dc0613c
--
-- Problem: Label says "Estimated line set length per unit (meters/feet)" but value is total count
-- Fix: Update label to "Number of line sets (indoor units)" in both widget_configs and draft_config
--
-- Run this against your Supabase database:

-- 1. Update widget_configs config_json field labels
UPDATE widget_configs
SET config_json = jsonb_set(
  config_json,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN field->>'fieldId' = 'line_set_count'
        THEN jsonb_set(
          jsonb_set(field, '{label}', '"Number of line sets (indoor units)"'),
          '{helpText}', '"How many indoor units need line sets?"'
        )
        ELSE field
      END
    )
    FROM jsonb_array_elements(config_json->'fields') AS field
  )
)
WHERE service_id = '4f2b05cb-70f1-4912-bab1-de778dc0613c';

-- 2. Update services draft_config suggestedFields labels
UPDATE services
SET draft_config = jsonb_set(
  draft_config,
  '{suggestedFields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN field->>'fieldId' = 'line_set_count'
        THEN jsonb_set(
          jsonb_set(field, '{label}', '"Number of line sets (indoor units)"'),
          '{helpText}', '"How many indoor units need line sets?"'
        )
        ELSE field
      END
    )
    FROM jsonb_array_elements(draft_config->'suggestedFields') AS field
  )
)
WHERE id = '4f2b05cb-70f1-4912-bab1-de778dc0613c'
  AND draft_config IS NOT NULL
  AND draft_config->'suggestedFields' IS NOT NULL;
