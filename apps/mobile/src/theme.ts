/**
 * The Measured Document palette: the same tokens as the web app
 * (Docs/design/system.md decides; apps/web/src/app/globals.css holds them).
 *
 * Rules that matter here:
 *   - The standard button is juniper. No button in the app is yellow.
 *   - Yellow is "needs you" only, always with dark text and its dark marker.
 *   - Butter and tape are for measurement only (the takeoff, grades, ranges).
 *   - Text is ink, never pure black.
 */
export const colors = {
  brand: '#205E56', // juniper: the brand, links, the standard button
  brandPressed: '#174741',
  paper: '#FAF9F6',
  surface: '#F2F0EA',
  white: '#FFFFFF',
  mint: '#DFEDE5',
  mist: '#EAEFF5',
  ink: '#1B2823',
  textSecondary: '#4F5D57',
  muted: '#626C66', // small notes; 4.5:1 on paper and white
  line: '#E5E2D8', // decoration: cards, dividers
  lineStrong: '#CFCBBD',
  field: '#808781', // the edge of a field or an outlined control; 3:1
  accent: '#FFC53D', // "needs you" only
  onAccent: '#1B2823',
  secondary: '#326B49', // done, accepted
  secondaryLight: '#E0F0E4',
  tertiary: '#7F5710', // a warning, a notice
  tertiaryLine: '#CFC0A6',
  danger: '#A23D2F',
  dangerLight: '#F8E3DD',
  butter: '#F7E9C6', // measurement only
  tape: '#DCAF3E', // measurement only
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }

/**
 * T-205: the widest a screen's content gets. On a phone nothing changes (no phone is this wide).
 * On an iPad the content is one readable column in the middle of the screen, instead of rows and
 * buttons stretched a thousand points from edge to edge.
 */
export const layout = { contentMaxWidth: 720 }

/** The web's one radius scale: 6 small controls, 8 buttons and fields, 12 cards, 16 panels */
export const radius = { sm: 6, md: 8, lg: 12, xl: 16 }

/**
 * Sizes for a hand on site. The design rule is 44 px for anything pressed;
 * the app's main buttons and rows are larger because they are pressed
 * one-handed, often with gloves on or a ladder in the other hand.
 */
export const touch = { min: 44, row: 56, main: 58 }

export const type = {
  note: 12,
  small: 14,
  body: 16,
  large: 18,
  title: 24,
  figure: 36,
}

/**
 * The brand faces (Docs/design/system.md, Type): Bricolage Grotesque for
 * headings and the wordmark, Instrument Sans for text and, in the app, for
 * figures too (T-185). Each weight is its own font file, so a style names the
 * family and never sets `fontWeight` beside it (a weight on a custom face
 * falls back to the phone's own font). They are loaded once in app/_layout;
 * until then, and if they cannot be loaded, the phone's own font is used.
 */
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  body: 'InstrumentSans_400Regular',
  semi: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
  // T-185 (owner, after the phone test): in the app, money and dates are set in the text face with
  // tabular figures (every digit the same width, so columns line up), not in the mono face the web uses
  figure: 'InstrumentSans_400Regular',
  figureBold: 'InstrumentSans_700Bold',
}

/** Beside `fonts.figure` and `fonts.figureBold`: digits of one width, so amounts and dates line up */
export const tabular: Array<'tabular-nums'> = ['tabular-nums']

/**
 * Dynamic Type: text grows with the phone's text-size setting. The largest
 * figures and titles stop at 1.4 times so a price never runs off the screen;
 * ordinary text follows the setting all the way to 2 times.
 */
export const scale = { text: 2, large: 1.4 }

/** One icon set for the whole app: Ionicons, outline style, these sizes */
export const icon = { small: 18, row: 22, tab: 26, large: 32 }
