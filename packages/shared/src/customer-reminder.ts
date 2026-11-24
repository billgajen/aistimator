/**
 * T-201: the one automatic reminder to a customer (the daily job, /api/cron/lifecycle), and the
 * business's switch for it in Settings.
 *
 * The reminder goes to a customer whose estimate has been waiting for an answer for
 * CUSTOMER_REMINDER_DAYS days: sent, opened or not, and neither accepted nor declined. So the switch
 * says "answered", not "opened": a customer who opened the estimate and said nothing is reminded too.
 */
export const CUSTOMER_REMINDER_DAYS = 3

export const CUSTOMER_REMINDER_COPY = {
  title: 'Reminder to the customer',
  label: `Send one reminder to the customer if they haven’t answered the estimate after ${CUSTOMER_REMINDER_DAYS} days`,
  help: 'One email, once. It goes only to a customer who has neither accepted nor declined. Switch it off and no reminder is sent, including for estimates you have already sent.',
  savedOn: 'Saved. Reminders are on.',
  savedOff: 'Saved. No reminders will be sent.',
} as const

/** A business with no answer stored has the reminder on (what happened before there was a switch) */
export const customerReminderOn = (stored: boolean | null | undefined): boolean => stored !== false
