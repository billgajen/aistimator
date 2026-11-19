/**
 * The photos the full-screen viewer shows (T-184). A quote's photos are
 * short-lived signed addresses, far too long to pass in a link between
 * screens, so the quote screen leaves them here and the viewer picks them up.
 */
export interface ViewerPhoto {
  id: string
  /** The photo itself; the small copy when that is all there is */
  url: string
}

let current: ViewerPhoto[] = []

export function setViewerPhotos(photos: ViewerPhoto[]): void {
  current = photos
}

export function viewerPhotos(): ViewerPhoto[] {
  return current
}
