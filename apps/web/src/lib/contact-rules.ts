/**
 * T-151: which contact details a customer must give — pure, client-safe.
 *
 * Per business (tenants.contact_requirement): 'email' (email required, phone
 * optional — the default), 'phone' (phone required, email optional) or
 * 'both'. A name is always required, and so is at least one way to reach the
 * customer. The widget, the leads API and the public quotes API all use this,
 * so the same request can't pass in one place and fail in another.
 */

export type ContactRequirement = 'email' | 'phone' | 'both'
export const CONTACT_REQUIREMENTS: readonly ContactRequirement[] = ['email', 'phone', 'both']

export function contactRequirementOf(value: unknown): ContactRequirement {
  return CONTACT_REQUIREMENTS.includes(value as ContactRequirement) ? (value as ContactRequirement) : 'email'
}

export interface ContactInput {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export interface ContactCheck {
  ok: boolean
  errors: Partial<Record<'name' | 'email' | 'phone', string>>
  /** Trimmed values, empty → null (stored as the customer typed them) */
  clean: { name: string; email: string | null; phone: string | null }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A phone number with a plausible number of digits (7–15, E.164's limit). */
export function isPlausiblePhone(phone: string): boolean {
  const digits = phone.replace(/[^0-9]/g, '')
  return digits.length >= 7 && digits.length <= 15 && /^[+0-9()\-.\s]+$/.test(phone.trim())
}

export function checkContact(input: ContactInput, requirement: ContactRequirement): ContactCheck {
  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim()
  const phone = (input.phone ?? '').trim()
  const errors: ContactCheck['errors'] = {}
  if (!name) errors.name = 'Please enter your name.'
  else if (name.length > 120) errors.name = 'Please shorten your name.'
  const needEmail = requirement === 'email' || requirement === 'both'
  const needPhone = requirement === 'phone' || requirement === 'both'
  if (email ? !EMAIL_RE.test(email) || email.length > 254 : needEmail) errors.email = 'Please enter a valid email address.'
  if (phone ? !isPlausiblePhone(phone) : needPhone) errors.phone = 'Please enter a valid phone number.'
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    clean: { name, email: email || null, phone: phone || null },
  }
}

/**
 * Contact details an AI chat extracted (not typed into fields): an optional
 * value that doesn't validate ("not provided", "N/A") is dropped instead of
 * failing the whole check. Required values are kept so the check still fails.
 */
export function usableContact(input: ContactInput, requirement: ContactRequirement): { name: string; email: string; phone: string } {
  const email = (input.email ?? '').trim()
  const phone = (input.phone ?? '').trim()
  const emailOk = EMAIL_RE.test(email)
  const phoneOk = isPlausiblePhone(phone)
  return {
    name: (input.name ?? '').trim(),
    email: emailOk || requirement !== 'phone' ? email : '',
    phone: phoneOk || requirement !== 'email' ? phone : '',
  }
}

/** The free-text description is required only when the service asks no questions of its own. */
export function descriptionRequired(serviceQuestionCount: number): boolean {
  return serviceQuestionCount === 0
}
