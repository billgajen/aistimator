/**
 * T-207: what happens when a guide's window opens and closes, as plain
 * functions (no React, no browser), so a unit test can run them.
 *
 * The window is the browser's own modal dialog (`showModal`): the browser
 * keeps the focus inside it, closes it on Escape, and tells us with one
 * `close` event however it was closed (Escape, the Close button, a click on
 * the dimmed page).
 */
export interface DialogLike {
  open: boolean
  showModal(): void
  close(): void
}
export interface VideoLike {
  play(): Promise<void> | void
  pause(): void
  focus?(): void
}
export interface FocusLike {
  focus(): void
}

/**
 * The link was pressed. Called from inside the press itself, so the browser
 * lets the video start with its sound on. A video that cannot start (a
 * browser setting, no connection) stays on its poster with its controls.
 */
export function openGuide(dialog: DialogLike | null, video: VideoLike | null): void {
  if (!dialog) return
  if (!dialog.open) dialog.showModal()
  if (!video) return
  video.focus?.()
  try {
    const started = video.play()
    if (started && typeof started.catch === 'function') started.catch(() => undefined)
  } catch {
    // the controls are there
  }
}

/** The window has closed: the video stops, the guide is remembered, and the focus goes back to the link. */
export function guideClosed(video: VideoLike | null, opener: FocusLike | null, remember: () => void): void {
  video?.pause()
  remember()
  opener?.focus()
}
