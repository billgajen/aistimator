/**
 * T-201: the rules and the words of "Try again" on a request that could not
 * be priced. T-202: they live in @qolumns/shared (quote-retry.ts), because the
 * phone app shows the same button with the same words; this file passes them
 * on to the web's own code (lib/quote-retry.ts does the work on the server).
 */
export { BUSINESS_RETRY_LIMIT, RETRY_COPY, businessRetriesOf, canBusinessRetry, tryAgainView } from '@qolumns/shared'
