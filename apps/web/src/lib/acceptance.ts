/**
 * T-151: what the customer tells the business when accepting — when suits
 * them, the job address and a phone number. Pure, client-safe. Only what the
 * customer typed is kept.
 */
import { isPlausiblePhone } from '@/lib/contact-rules'

export const TIMING_CHOICES = [
  { value: 'asap', label: 'As soon as possible' },
  { value: 'two_weeks', label: 'Within the next two weeks' },
  { value: 'flexible', label: "I'm flexible" },
] as const
export type Timing = (typeof TIMING_CHOICES)[number]['value']

export interface AcceptanceDetails {
  timing: Timing
  timingNote: string | null
  address: string
  phone: string
  submittedAt: string
}

export function timingLabel(value: string): string {
  return TIMING_CHOICES.find((c) => c.value === value)?.label ?? value
}

export function checkAcceptance(
  input: { timing?: unknown; timingNote?: unknown; address?: unknown; phone?: unknown },
  now = new Date()
): { ok: true; value: AcceptanceDetails } | { ok: false; errors: Partial<Record<'timing' | 'address' | 'phone' | 'timingNote', string>> } {
  const errors: Partial<Record<'timing' | 'address' | 'phone' | 'timingNote', string>> = {}
  const timing = typeof input.timing === 'string' ? input.timing : ''
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const note = typeof input.timingNote === 'string' ? input.timingNote.trim() : ''
  if (!TIMING_CHOICES.some((c) => c.value === timing)) errors.timing = 'Please choose when suits you.'
  if (address.length < 5) errors.address = 'Please enter the address of the job.'
  else if (address.length > 300) errors.address = 'Please shorten the address.'
  if (!isPlausiblePhone(phone)) errors.phone = 'Please enter a phone number we can reach you on.'
  if (note.length > 500) errors.timingNote = 'Please shorten the note.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { timing: timing as Timing, timingNote: note || null, address, phone, submittedAt: now.toISOString() } }
}
