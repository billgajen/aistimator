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
