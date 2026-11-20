'use client'

import { useEffect, useRef } from 'react'

/**
 * T-194: a scanned area's floor plan, the width of its card (larger on a
 * phone), and a tap opens it larger. The plan is our own SVG: only numbers,
 * wall letters and the escaped name go into it (floorPlanSvg).
 */
export function PlanView({ svg, name }: { svg: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const close = (e: MouseEvent) => e.target === d && d.close()
    d.addEventListener('click', close)
    return () => d.removeEventListener('click', close)
  }, [])
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="mt-3 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-tape/40 bg-white p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Floor plan of ${name}. Open it larger`}
        data-testid="room-plan"
      >
        <div className="mx-auto max-w-lg [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <span className="mt-1 block text-center text-xs text-text-muted">Tap to enlarge</span>
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(96vw,1100px)] max-w-none rounded-2xl bg-white p-3 backdrop:bg-ink/60"
        aria-label={`Floor plan of ${name}`}
        data-testid="room-plan-large"
      >
        <div className="[&>svg]:h-auto [&>svg]:max-h-[80vh] [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <form method="dialog" className="mt-2 text-right">
          <button className="inline-flex min-h-[44px] items-center rounded-xl border border-border-strong px-4 text-sm font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Close
          </button>
        </form>
      </dialog>
    </>
  )
}
