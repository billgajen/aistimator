/**
 * T-152: the product's own name and defaults — one place, so customer-facing
 * and dashboard text never carries a stale name.
 */
export const PRODUCT_NAME = 'Aistimator'

/** The brand colour a new business starts with (migration 3 default). */
export const DEFAULT_PRIMARY_COLOR = '#2563eb'

/**
 * T-154: the support address shown on the marketing site (founder section,
 * footer). Empty until the domain is chosen: anything that shows it renders
 * nothing while it is empty, so filling it in is one edit.
 */
export const SUPPORT_EMAIL = ''
