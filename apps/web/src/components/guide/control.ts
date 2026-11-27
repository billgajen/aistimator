/**
 * T-207: what happens when a guide's window opens and closes, as plain
 * functions (no React, no browser), so a unit test can run them.
 *
 * The window is the browser's own modal dialog (`showModal`): the browser
 * keeps the focus inside it, closes it on Escape, and tells us with one
 * `close` event however it was closed (Escape, the ✕, a press on the dark
 * page around the video).
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

/**
 * The window has closed: the video stops, the guide is remembered (where the button that opened it remembers:
 * the dashboard's link does, a marketing page's button does not), and the focus goes back to the button.
 */
export function guideClosed(video: VideoLike | null, opener: FocusLike | null, remember?: () => void): void {
  video?.pause()
  remember?.()
  opener?.focus()
}

/**
 * T-208: the window fills the screen and only the video is not "the dark part", so a press anywhere else closes
 * it. A press counts only when it both began and ended off the video: dragging the video's own slider and
 * letting go below it is not a press on the dark part. (The ✕ closes by its own handler, also from the keyboard.)
 */
export function pressClosesWindow(began: { tagName: string } | null, ended: { tagName: string } | null): boolean {
  const onVideo = (el: { tagName: string } | null) => el?.tagName === 'VIDEO'
  return began !== null && ended !== null && !onVideo(began) && !onVideo(ended)
}
