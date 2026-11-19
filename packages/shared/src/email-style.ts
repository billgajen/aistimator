/**
 * T-191: the design system in an email. Every email (to a business and to a customer) takes its colours and type
 * from here, not from a generic grey-and-blue kit.
 *
 * - Colours are the tokens of Docs/design/system.md (apps/web/src/app/globals.css). A unit test compares every
 *   value here with globals.css, and every colour in the email files with this list.
 * - Type: Instrument Sans for text and Bricolage Grotesque for headings, served from our own domain (no third
 *   party sees who opens an email). Apple Mail and iOS Mail show them; Gmail and Outlook ignore web fonts and show
 *   the system face named next in the list. Figures use Spline Sans Mono where the reader has it, else the
 *   text face with tabular figures.
 * - An email to a customer is the business's document: its button and total are in the business's own colour
 *   (`brandColourForEmail`, juniper when none is set, as on the quote page), with text that reads on it.
 *   An email to a business is the product's: juniper.
 */
import { APP_DOMAIN } from './brand'
import { contrastRatio, isValidHexColor, readableTextOn } from './colour-contrast'

export const EMAIL_COLOR = {
  /** the page behind the card */
  paper: '#FAF9F6',
  card: '#FFFFFF',
  /** a quiet panel inside the card */
  surface: '#F2F0EA',
  mist: '#EAEFF5',
  mint: '#DFEDE5',
  ink: '#1B2823',
  textSecondary: '#4F5D57',
  muted: '#626C66',
  border: '#E5E2D8',
  borderStrong: '#CFCBBD',
  juniper: '#205E56',
  success: '#326B49',
  successLight: '#E0F0E4',
  /** amber ink for a warning; its panel is `surface` with a `warningLine` edge (never butter: that is measurement) */
  warning: '#7F5710',
  warningLine: '#CFC0A6',
  danger: '#A23D2F',
  dangerLight: '#F8E3DD',
  dangerLine: '#DBB7B0',
} as const

const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const EMAIL_FONT = {
  body: `'Instrument Sans', ${SYSTEM_SANS}`,
  display: `'Bricolage Grotesque', 'Instrument Sans', ${SYSTEM_SANS}`,
  // without Spline Sans Mono a system monospace reads as a typewriter: fall back to the text face (with tabular figures)
  figure: `'Spline Sans Mono', 'Instrument Sans', ${SYSTEM_SANS}`,
} as const

/** The font files the web app serves (apps/web/public/brand/fonts), OFL-licensed */
export const EMAIL_FONT_FILES = [
  { family: 'Instrument Sans', weight: 400, file: 'InstrumentSans-400.ttf' },
  { family: 'Instrument Sans', weight: 600, file: 'InstrumentSans-600.ttf' },
  { family: 'Bricolage Grotesque', weight: 700, file: 'BricolageGrotesque-700.ttf' },
] as const

/** For an email's <head>: the faces from our domain, and headings in the display face */
export function emailHeadStyle(): string {
  const faces = EMAIL_FONT_FILES.map(
    (f) => `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: normal; src: url('https://${APP_DOMAIN}/brand/fonts/${f.file}') format('truetype'); }`
  ).join('\n    ')
  return `<style>
    ${faces}
    h1, h2 { font-family: ${EMAIL_FONT.display}; letter-spacing: -0.01em; }
  </style>`
}

/** The business's colour for its email to a customer: its own when it set a valid one, else juniper */
export function brandColourForEmail(primaryColor: string | null | undefined): string {
  return isValidHexColor(primaryColor) ? primaryColor : EMAIL_COLOR.juniper
}

/** The colour as text on the white card: itself when it reads at 4.5:1, else ink (a light brand colour is never text) */
export function textColourOnCardForEmail(colour: string): string {
  return contrastRatio(colour, EMAIL_COLOR.card) >= 4.5 ? colour : EMAIL_COLOR.ink
}

/** Text that reads on a button in that colour (4.5:1, T-171) */
export function textOnColourForEmail(background: string): string {
  return readableTextOn(background)
}
