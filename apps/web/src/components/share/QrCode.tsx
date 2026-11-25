'use client'

import { useEffect, useRef } from 'react'
import { qrMatrix, qrToRgba, qrToSvg } from '@/lib/qr'

/**
 * T-149: QR code for the quote link, drawn in the browser, with a PNG download.
 * T-202: downloading it ticks "Share your quote link" on Home (best-effort,
 * like Copy: the download never waits for it).
 * T-204: also as SVG, the same code as a vector, sharp at any size. Either
 * download ticks the step the same way.
 */
export function QrCode({ value, fileName }: { value: string; fileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { data, size } = qrToRgba(qrMatrix(value), 10, 4)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(size, size)
    image.data.set(data)
    ctx.putImageData(image, 0, 0)
  }, [value])

  /** Hand the browser a file, then tick the share step (never waited for) */
  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/tenant/share-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'qr' }),
    }).catch(() => undefined)
  }

  function download() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) save(blob, fileName)
    }, 'image/png')
  }

  function downloadSvg() {
    save(new Blob([qrToSvg(qrMatrix(value))], { type: 'image/svg+xml' }), fileName.replace(/\.png$/i, '') + '.svg')
  }

  const button = 'inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-semibold text-text-primary hover:bg-surface'

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`QR code for ${value}`}
        className="h-44 w-44 rounded-xl border border-border bg-white"
      />
      <div className="text-center sm:text-left">
        <p className="text-sm text-text-secondary">
          Put it on your van, flyers, business cards or invoices. Customers point their phone camera at it and land on
          your quote page.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" data-testid="qr-download" onClick={download} className={button}>
            Download PNG
          </button>
          <button type="button" data-testid="qr-download-svg" onClick={downloadSvg} className={button}>
            Download SVG
          </button>
        </div>
        <p className="mt-2 text-xs text-text-muted">PNG for a screen or a document. SVG for a printer or a sign: it stays sharp at any size.</p>
      </div>
    </div>
  )
}
