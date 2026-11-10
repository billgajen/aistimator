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

/** T-152: a ready text for the WhatsApp Business app, with where to paste it. */
export interface WhatsAppText {
  id: 'greeting' | 'away' | 'quick_reply'
  label: string
  /** Two lines: where it lives in the app, then what to do there */
  steps: [string, string]
  text: string
}

/**
 * T-152: "Use it on WhatsApp" on Share — texts for the free WhatsApp Business
 * app, each carrying the business's own quote link. Pure.
 */
export function buildWhatsAppTexts(opts: { businessName: string; link: string; region?: string | null }): WhatsAppText[] {
  const { businessName, link } = opts
  const noun = getRegion(opts.region).copy.requestNoun
  return [
    {
      id: 'greeting',
      label: 'Greeting message',
      steps: [
        'In WhatsApp Business: Settings → Business tools → Greeting message.',
        'Turn on "Send greeting message", tap Message, paste this and save.',
      ],
      text: `Hi, thanks for messaging ${businessName}! For ${noun}, send a few details and photos of your job here: ${link}`,
    },
    {
      id: 'away',
      label: 'Away message',
      steps: [
        'In WhatsApp Business: Settings → Business tools → Away message.',
        'Turn on "Send away message", tap Message, paste this, then pick when it sends.',
      ],
      text: `Thanks for your message. We're away right now and will reply as soon as we can. To get ${noun} in the meantime, send a few details and photos here: ${link}`,
    },
    {
      id: 'quick_reply',
      label: 'Quick reply',
      steps: [
        'In WhatsApp Business: Settings → Business tools → Quick replies → +.',
        'Paste this as the message and give it a shortcut such as /quote. In a chat, type / to send it.',
      ],
      text: `You can get ${noun} by sending a few details and photos of the job here: ${link}`,
    },
  ]
}

/** T-152: the message "Send on WhatsApp" opens with — the business picks the chat. */
export function whatsAppSendMessage(opts: { businessName: string; link: string; region?: string | null }): string {
  const noun = getRegion(opts.region).copy.requestNoun
  return `Here's where you can get ${noun} from ${opts.businessName}: ${opts.link}`
}

/** T-152: WhatsApp's own share link (opens the app, or WhatsApp Web, with the text ready). */
export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
