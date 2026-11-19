/**
 * T-190: the wordmark in the app is the owner's drawing (brand/qolumns-wordmark.png), saved as
 * assets/wordmark.png at three times the size it is shown. Its shown size is fixed here, so the sign-in screen
 * lays out before the picture loads.
 */
export const WORDMARK_FILE = { width: 480, height: 129 } as const
const SHOWN_WIDTH = 160
export const WORDMARK_SIZE = { width: SHOWN_WIDTH, height: Math.round((SHOWN_WIDTH * WORDMARK_FILE.height) / WORDMARK_FILE.width) } as const
