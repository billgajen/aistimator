/**
 * T-201: changing the password from Settings. What is typed is checked here,
 * before anything is asked of Supabase. Pure.
 *
 * The rules for the new password are sign-up's and reset's own (`passwordProblem`,
 * given in so this file needs no server code). Nothing here logs or returns a password.
 */
/** The form's own minimum, for the field and its hint. The same number as sign-up's (auth-flow.ts, server only); a unit test holds them together. */
export const NEW_PASSWORD_MIN_LENGTH = 8

export const CHANGE_PASSWORD_COPY = {
  title: 'Change password',
  intro: 'You stay logged in on this device. Other devices may ask you to log in again.',
  current: 'Current password',
  next: 'New password',
  confirm: 'New password again',
  button: 'Change password',
  saving: 'Changing...',
  done: 'Your password is changed.',
  needCurrent: 'Enter your current password.',
  mismatch: 'The two new passwords do not match.',
  same: 'Choose a new password that is different from your current one.',
  wrongCurrent: 'Your current password is not right.',
  signedOut: 'Log in again to change your password.',
  failed: 'We could not change the password just now. Please try again.',
} as const

export interface ChangePasswordInput {
  currentPassword?: unknown
  newPassword?: unknown
  confirmPassword?: unknown
}

/** The first thing wrong with what was typed, as a sentence for the form; null when it can go ahead */
export function changePasswordProblem(input: ChangePasswordInput | null | undefined, passwordProblem: (value: unknown) => string | null): string | null {
  const C = CHANGE_PASSWORD_COPY
  if (typeof input?.currentPassword !== 'string' || !input.currentPassword) return C.needCurrent
  const problem = passwordProblem(input.newPassword)
  if (problem) return problem
  if (input.newPassword !== input.confirmPassword) return C.mismatch
  if (input.newPassword === input.currentPassword) return C.same
  return null
}
