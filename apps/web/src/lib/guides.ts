import { APP_DOMAIN, PRODUCT_NAME } from '@qolumns/shared'

/**
 * T-207: the guide videos, in one list.
 *
 * **This is the only file that names a guide file.** Every screen that shows a
 * guide asks for it by id (`<GuideLink id="add-service" />`), so a renamed or
 * re-made video is changed here and nowhere else. A unit test holds both
 * halves: every file named here is in `public/guides`, and no other file in
 * the web app spells that folder.
 *
 * The videos are made by hand outside the repo (screen recordings with a
 * voiceover; the captions are part of the picture). When a screen changes, its
 * video is recorded again and the file replaced: nothing here builds one.
 * `seconds` and `transcript` are typed from the finished video, so a re-made
 * video changes them too.
 */
export type GuideId = 'hero' | 'add-service' | 'set-prices' | 'test-pricing' | 'quote-link' | 'approve' | 'on-site'

/** One video file with its poster frame, and the size of its picture */
export interface GuideSource {
  src: string
  poster: string
  width: number
  height: number
}

export interface Guide extends GuideSource {
  id: GuideId
  title: string
  /** The video's length, as the link says it ("Watch how · 32 s") */
  seconds: number
  /**
   * The voiceover, one line to a sentence or two, as it is spoken. The captions are part of the picture, so
   * this is not shown (T-208): it is in the guide's window for a screen reader only.
   */
  transcript: readonly string[]
  /** The hero only: the same video upright, for a phone. `src` and `poster` are the wide one. */
  tall?: GuideSource
}

const FOLDER = '/guides'
const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }
const files = (name: string, size: { width: number; height: number }): GuideSource => ({
  src: `${FOLDER}/${name}.mp4`,
  poster: `${FOLDER}/${name}.jpg`,
  ...size,
})

export const GUIDES: Record<GuideId, Guide> = {
  hero: {
    id: 'hero',
    title: 'Photo in, quote out',
    seconds: 33,
    ...files('hero-16x9', WIDE),
    tall: files('hero-9x16', TALL),
    transcript: [
      "Your customers want a price before they'll book a visit.",
      `With ${PRODUCT_NAME}, they snap a few photos and answer a few questions, right on your website.`,
      `${PRODUCT_NAME} reads the photos, and prices the job from your own price list.`,
      'You check it, and tap approve.',
      'Your customer gets a professional quote, every line explained, with a button to accept.',
      `${PRODUCT_NAME}. Photo estimates for trades. Start free at ${APP_DOMAIN}.`,
    ],
  },
  'add-service': {
    id: 'add-service',
    title: 'Add a service',
    seconds: 32,
    ...files('guide-1-add-a-service', WIDE),
    transcript: [
      'Start by adding the jobs you do.',
      `Pick a ready-made template, or describe your own service, and ${PRODUCT_NAME} drafts it for you.`,
      'Each template comes with the questions to ask, the photos to request, and example prices.',
      "Check what's included and what isn't, so every quote is clear.",
      'Then choose what to ask your customers. Their answers feed straight into the price.',
    ],
  },
  'set-prices': {
    id: 'set-prices',
    title: 'Set your prices',
    seconds: 25,
    ...files('guide-2-set-your-prices', WIDE),
    transcript: [
      'Next, set your prices.',
      "Describe how you charge, the way you'd explain it to a customer.",
      `${PRODUCT_NAME} turns it into clear rules. A call-out fee, a price per room, and a minimum job.`,
      'Extras like high ceilings are added only when they apply. And you can change any number.',
    ],
  },
  'test-pricing': {
    id: 'test-pricing',
    title: 'Test your pricing',
    seconds: 23,
    ...files('guide-3-test-your-pricing', WIDE),
    transcript: [
      'Before you go live, test your pricing.',
      'Try a sample job. Two rooms, high ceilings, light prep.',
      'You see exactly what that customer would pay, line by line, worked out the same way as a real request.',
      'When it looks right, switch the service on, and start quoting.',
    ],
  },
  'quote-link': {
    id: 'quote-link',
    title: 'Share your quote link',
    seconds: 29,
    ...files('guide-4-share-your-quote-link', WIDE),
    transcript: [
      "Your quote link works even if you don't have a website.",
      'Copy it and send it anywhere. On Pro, you can choose an address with your name in it.',
      'Put the QR code on your van, flyers or invoices, and paste ready-made lines into Google, Facebook, or your email signature.',
      'Have a website? Paste one piece of code, or send it to whoever looks after the site.',
    ],
  },
  approve: {
    id: 'approve',
    title: 'Check and approve',
    seconds: 26,
    ...files('guide-5-check-and-approve', WIDE),
    transcript: [
      "When a quote needs you, it's at the top of your list.",
      'Open it to see the price, and what to do next.',
      'Need a change? Add a line, adjust a price, or leave yourself a note.',
      'The total updates as you go. Then save and send, and your customer gets the quote straight away.',
    ],
  },
  'on-site': {
    id: 'on-site',
    title: 'Quote on site',
    seconds: 39,
    ...files('guide-6-quote-on-site', WIDE),
    transcript: [
      'With the app, you can quote on site.',
      'Start a quote, pick the job, and snap a few photos.',
      'Then scan the room. Walk around with your phone, and it measures the walls and floor as you go.',
      'You get a 3D model, with the floor and wall areas already worked out.',
      'Every wall is listed, and you can turn the model around in 3D.',
      'The price comes from your own price list, ready to approve and send before you leave.',
    ],
  },
}

export function guide(id: GuideId): Guide {
  return GUIDES[id]
}

/** Under this width a guide that has an upright video plays that one (T-208): a phone held upright */
export const UPRIGHT_UNDER = 640
export const UPRIGHT_QUERY = `(max-width: ${UPRIGHT_UNDER - 1}px)`

/** The video a guide's window plays on this screen: the upright one on a narrow screen, when the guide has one */
export function sourceFor(g: Guide, narrow: boolean): GuideSource {
  return narrow && g.tall ? g.tall : g
}

/** The six how-to guides, in the order a new business needs them (Home's "Getting started", the support page) */
export const SETUP_GUIDES: readonly GuideId[] = ['add-service', 'set-prices', 'test-pricing', 'quote-link', 'approve', 'on-site']

/** The words every guide shares */
export const GUIDE_COPY = {
  watch: 'Watch how',
  watched: 'Watched',
  close: 'Close',
  gettingStarted: 'Getting started',
  gettingStartedLine: 'Six short videos, each under a minute. They play with sound.',
  hide: 'Hide',
  videoGuides: 'Video guides',
  videoGuidesLine: 'Six short videos that show each step, each under a minute. They play with sound, and the words are shown on the picture.',
  /** A marketing page's video button ("See how it works · 33 s"), as a screen reader says it */
  buttonLabel: (words: string, g: Guide) => `${words} (video, ${g.seconds} seconds, with sound)`,
  /** A guide link, as a screen reader says it */
  linkLabel: (g: Guide, watched: boolean) => `Watch how: ${g.title} (${g.seconds} seconds)${watched ? ', watched' : ''}`,
} as const

/** A guide counts as watched once this share of it has played (or its window was closed) */
export const WATCHED_SHARE = 0.8

export function watchedEnough(currentTime: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && currentTime / duration >= WATCHED_SHARE
}

/** Home's "Getting started" card shows while the business has sent fewer than this many quotes */
export const GETTING_STARTED_UNTIL = 3

export function showGettingStarted(sentQuotes: number, hidden: boolean): boolean {
  return !hidden && sentQuotes < GETTING_STARTED_UNTIL
}

/** Where the browser remembers a watched guide (one key per guide) */
export const watchedKey = (id: GuideId) => `qolumns.guide.watched.${id}`

/** Where the browser remembers that a business hid "Getting started" (one key per business) */
export const gettingStartedHiddenKey = (tenantId: string) => `qolumns.guide.getting-started-hidden.${tenantId}`
