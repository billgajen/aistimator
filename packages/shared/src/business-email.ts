/**
 * Where emails to the business go (T-157). One rule for the web app and the
 * worker:
 *
 * 1. the notification email from Settings > Notifications, when set;
 * 2. otherwise the account email of the tenant's first user;
 * 3. the demo business (T-153) emails no one.
 *
 * The same address is the reply-to on emails to the customer.
 * Pure: the callers load the two addresses.
 */
export function chooseBusinessEmail(input: {
  isDemo?: boolean | null
  notificationEmail?: string | null
  ownerEmail?: string | null
}): string | null {
  if (input.isDemo) return null
  const setting = input.notificationEmail?.trim()
  if (setting) return setting
  return input.ownerEmail?.trim() || null
}

/**
 * Take email addresses out of a text before it is logged. The email
 * provider's error messages can name the recipient ("Found inactive
 * addresses: …"), and callers log those errors.
 */
export function redactEmails(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[address]')
}
