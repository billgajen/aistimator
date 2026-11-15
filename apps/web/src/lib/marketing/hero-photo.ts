/**
 * T-168: the home page's hero photograph. A scene photograph made with an
 * image model under the rules in Docs/design/system.md (Imagery): a
 * situation, never a customer; no brand, no text or screen drawn by the
 * model; real alt text, no caption. How it was made, what was changed in it
 * and what was rejected is in Docs/design/photos.md (it is option b of four).
 */
export const HERO_PHOTO = {
  /** What the picture shows, for a screen reader (no caption is shown) */
  alt: 'A house painter in white overalls stands on a front porch, checking a phone; a paint roller rests in a tray at their feet.',
  /** Width and height of the 2400 px file, so the page keeps its shape while it loads */
  width: 2400,
  height: 1451,
  /** Where the subject sits, for the phone's crop (CSS object-position) */
  focus: '74% 35%',
  /** How far down the picture the wide band looks (it is wider than the picture, so it shows a strip of it) */
  bandY: '10%',
} as const

export const heroPhotoSrc = (width: 1200 | 2400) => `/photos/hero-b-${width}.webp`
