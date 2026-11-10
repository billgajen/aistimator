/**
 * T-149: ready-to-copy texts for sharing a business's quote link — pure.
 *
 * Every text uses the business's own name and link; the wording differs by
 * region only where customers say it differently ("an estimate" / "a quote").
 * Nothing here promises a price or a speed the business hasn't set.
 */
import { getRegion } from '@estimator/shared'

export interface ShareText {
  id: 'google' | 'social_bio' | 'email_signature' | 'text_reply'
  label: string
  /** Where exactly to paste it */
  hint: string
  text: string
}

export function buildShareTexts(opts: { businessName: string; link: string; region?: string | null }): ShareText[] {
  const { businessName, link } = opts
  const noun = getRegion(opts.region).copy.requestNoun
  return [
    {
      id: 'google',
      label: 'Google Business Profile',
      hint: 'Paste the link under Edit profile → Contact → Appointment links, then post this as an update.',
      text: `Need ${noun}? Send ${businessName} a few details and photos of your job online, any time: ${link}`,
    },
    {
      id: 'social_bio',
      label: 'Facebook or Instagram bio',
      hint: 'Add it to your bio. On Facebook, you can also put the link on your page’s button.',
      text: `Get ${noun} online: ${link}`,
    },
    {
      id: 'email_signature',
      label: 'Email signature',
      hint: 'Add it under your name in your email settings.',
      text: `${businessName}\nGet ${noun} online: ${link}`,
    },
    {
      id: 'text_reply',
      label: 'Text message reply',
      hint: 'Save it as a quick reply for when someone asks for a price.',
      text: `Thanks for getting in touch with ${businessName}! You can get ${noun} by sending a few details and photos here: ${link}`,
    },
  ]
}

/**
 * "Send to my web person": a mailto: link with the embed code and plain
 * instructions. CRLF line breaks, as the mailto spec asks.
 */
export function webPersonMailto(opts: { businessName: string; link: string; embedCode: string; region?: string | null }): string {
  const noun = getRegion(opts.region).copy.requestNoun
  const subject = `Please add our ${noun.replace(/^an? /, '')} form to the website`
  const body = [
    'Hi,',
    '',
    `Could you add our ${noun.replace(/^an? /, '')} form to our website? Paste the code below where the form should appear, for example on the contact page. It works on any site that lets you add HTML (WordPress, Wix, Squarespace, Shopify and so on).`,
    '',
    opts.embedCode,
    '',
    `If adding code isn't possible, a button or menu link to our page works too: ${opts.link}`,
    '',
    'Thanks,',
    opts.businessName,
  ].join('\r\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
