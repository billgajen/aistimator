/**
 * T-165: the buttons of a marketing page (Docs/design/system.md, Colour).
 *
 * MAIN_CTA is the yellow button: dark text, a thin dark edge. One per screen:
 * the one main call to action. Every other button keeps the quieter styles
 * below. The dashboard does not use the yellow button.
 */
const BASE = 'motion-press inline-flex min-h-[48px] items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-semibold'

/** The one main call to action of a screen */
export const MAIN_CTA = `${BASE} border border-on-accent bg-accent text-on-accent`

/** A second action beside it, visibly quieter */
export const QUIET_BUTTON = `${BASE} border border-field bg-background text-text-primary hover:bg-surface`

/** A standard juniper button, where the screen already has its main call to action */
export const JUNIPER_BUTTON = `${BASE} bg-primary text-white hover:bg-primary-hover`

/** A link that reads as a link: for the quiet second action of the closing band */
export const QUIET_LINK = 'inline-flex min-h-[44px] items-center text-sm font-semibold underline underline-offset-4'

/**
 * T-208: a video button ("See how it works · 33 s"): words and a play mark, no ground and no edge, so it is
 * quieter than any button beside it. The words underline under the pointer (components/guide/WatchButton).
 */
export const WATCH_BUTTON = 'group motion-press inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold text-text-primary'
