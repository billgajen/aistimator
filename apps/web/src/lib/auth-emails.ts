/**
 * T-173: the account emails (confirm your email, reset your password, "you
 * already have an account"), sent by us through Postmark from the product's
 * own address. Until now they came from Supabase's built-in sender, which
 * allows only a few an hour and words them itself.
 *
 * Plain wording, the product's name, one button. The link in each is made by
 * the server (lib/auth-flow.ts) and works once.
 */
import { PRODUCT_NAME, emailShell, productLogoRow } from '@qolumns/shared'

/**
 * How long a link in these emails works, in minutes. It is Supabase's
 * "Email OTP Expiration" setting (`mailer_otp_exp`, 3600 seconds in
 * production). If that setting changes, change this to match.
 */
export const AUTH_LINK_MINUTES = 60

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const LINK_LASTS = AUTH_LINK_MINUTES === 60 ? 'one hour' : `${AUTH_LINK_MINUTES} minutes`

interface AuthEmail {
  subject: string
  htmlBody: string
  textBody: string
}

function layout(parts: { title: string; paragraphs: string[]; button: { label: string; url: string }; after: string[] }): string {
  const paragraph = (text: string) => `<p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">${text}</p>`
  const small = (text: string) => `<p style="margin: 16px 0 0; color: #626C66; font-size: 14px; line-height: 1.5;">${text}</p>`
  // T-204: the page is the one every email uses (fixed 600 px card, phone padding): emailShell
  return emailShell({
    title: parts.title,
    above: productLogoRow(),
    content: `<h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 700; color: #1B2823;">
                ${escapeHtml(parts.title)}
              </h1>
              ${parts.paragraphs.map(paragraph).join('\n              ')}
              <a href="${escapeHtml(parts.button.url)}" style="display: inline-block; margin: 8px 0; padding: 12px 24px; background-color: #205E56; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-weight: 600;">
                ${escapeHtml(parts.button.label)}
              </a>
              ${parts.after.map(small).join('\n              ')}
              <p style="margin: 32px 0 0; color: #626C66; font-size: 12px;">
                ${PRODUCT_NAME}
              </p>`,
  })
}

/** Sign-up: confirm the address and finish creating the account */
export function confirmEmail(data: { businessName: string; confirmUrl: string }): AuthEmail {
  const business = data.businessName.trim()
  const intro = business
    ? `You are setting up ${business} on ${PRODUCT_NAME}.`
    : `You are setting up an account on ${PRODUCT_NAME}.`
  const ask = 'Press the button to confirm this is your email address. That finishes creating your account and logs you in.'
  const lasts = `The link works once, for ${LINK_LASTS}.`
  const ignore = 'If you did not sign up, ignore this email. No account is created.'
  return {
    subject: `Confirm your email for ${PRODUCT_NAME}`,
    htmlBody: layout({
      title: 'Confirm your email',
      paragraphs: [escapeHtml(intro), ask],
      button: { label: 'Confirm my email', url: data.confirmUrl },
      after: [lasts, ignore],
    }),
    textBody: [intro, ask, `Confirm my email: ${data.confirmUrl}`, lasts, ignore, PRODUCT_NAME].join('\n\n'),
  }
}

/** A password reset was asked for */
export function resetPasswordEmail(data: { resetUrl: string }): AuthEmail {
  const intro = `Someone asked to reset the password for your ${PRODUCT_NAME} account.`
  const ask = 'Press the button to choose a new password.'
  const lasts = `The link works once, for ${LINK_LASTS}.`
  const ignore = 'If it was not you, ignore this email. Your password stays the same.'
  return {
    subject: `Reset your ${PRODUCT_NAME} password`,
    htmlBody: layout({
      title: 'Choose a new password',
      paragraphs: [intro, ask],
      button: { label: 'Choose a new password', url: data.resetUrl },
      after: [lasts, ignore],
    }),
    textBody: [intro, ask, `Choose a new password: ${data.resetUrl}`, lasts, ignore, PRODUCT_NAME].join('\n\n'),
  }
}

/** Someone signed up with an address that already has an account */
export function alreadyRegisteredEmail(data: { loginUrl: string; forgotUrl: string }): AuthEmail {
  const intro = `Someone tried to sign up for ${PRODUCT_NAME} with this email address. It already has an account, so no new one was made.`
  const ask = 'If it was you, log in with the password you chose before.'
  const forgot = `Forgotten your password? Reset it here: <a href="${escapeHtml(data.forgotUrl)}" style="color: #205E56;">${escapeHtml(data.forgotUrl)}</a>`
  const ignore = 'If it was not you, ignore this email. Nothing has changed.'
  return {
    subject: `You already have a ${PRODUCT_NAME} account`,
    htmlBody: layout({
      title: 'You already have an account',
      paragraphs: [intro, ask],
      button: { label: 'Log in', url: data.loginUrl },
      after: [forgot, ignore],
    }),
    textBody: [intro, ask, `Log in: ${data.loginUrl}`, `Forgotten your password? Reset it here: ${data.forgotUrl}`, ignore, PRODUCT_NAME].join('\n\n'),
  }
}
