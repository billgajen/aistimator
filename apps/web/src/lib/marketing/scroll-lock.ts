/**
 * T-155: stop the page behind a full-screen overlay from scrolling.
 * Locks both <html> and <body> (iOS Safari scrolls whichever one is allowed
 * to) and returns a function that puts back exactly what was there.
 */
interface Styled {
  style: { overflow: string; overscrollBehavior: string }
}

export function lockPageScroll(html: Styled, body: Styled): () => void {
  const before = [html.style.overflow, html.style.overscrollBehavior, body.style.overflow, body.style.overscrollBehavior] as const
  html.style.overflow = 'hidden'
  html.style.overscrollBehavior = 'none'
  body.style.overflow = 'hidden'
  body.style.overscrollBehavior = 'none'
  return () => {
    html.style.overflow = before[0]
    html.style.overscrollBehavior = before[1]
    body.style.overflow = before[2]
    body.style.overscrollBehavior = before[3]
  }
}
