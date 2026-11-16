/**
 * T-172: how a row of the quote checker's log (`quote_validation_logs`) is
 * marked, in `input_snapshot.serviceConfigVersion`.
 *
 * Until T-172 the checker was not told the business's minimum charge, base
 * fee, tax or currency, so it could flag a correct quote. Those rows are
 * marked 'v1'. From T-172 the worker tells it, and writes this marker; the
 * dashboard shows a checker finding only from a row that carries it.
 */
export const CHECKER_SETTINGS_VERSION = 'v2'
