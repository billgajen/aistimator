-- T-166 (AD-049): the quote checker flags, it never corrects.
--
-- Rows of quote_validation_logs with outcome 'auto_corrected' were never
-- corrected: the checker found issues, the business's setting said
-- "auto_correct", no fix was applied (corrections_applied is null on every
-- row) and the quote went on as priced, not held for review. The name said
-- the opposite of what happened. From T-166 the worker writes
-- 'passed_with_issues' for that case. This renames the old rows to match and
-- brings the two column comments up to date.
--
-- It changes a label and two comments. No quote, price or setting is touched.
-- Re-runnable.
--
-- Deploy ORDER: the worker first, this second. An old worker would go on
-- writing 'auto_corrected' after this ran, and those rows would need this
-- again (harmless, but pointless).
--
-- Not changed: tenants.validation_settings. Every business's stored setting
-- still reads "auto_correct" for critical, high and medium issues (the default
-- from migration 12). The worker reads it as "log the issues and let the quote
-- go on". Renaming or changing it is a decision for the owner (OWNER-TODO).

UPDATE quote_validation_logs
SET outcome = 'passed_with_issues'
WHERE outcome = 'auto_corrected';

COMMENT ON COLUMN quote_validation_logs.outcome IS
  'What the checker''s findings led to: passed, passed_with_issues (issues logged, quote not held; called auto_corrected before T-166), sent_for_review, blocked';
COMMENT ON COLUMN quote_validation_logs.corrections_applied IS
  'Unused. The checker never corrects a quote (T-166, AD-049); this was null on every row before T-166 and is always null after.';
