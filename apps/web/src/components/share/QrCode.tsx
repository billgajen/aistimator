'use client'

import { useEffect, useRef } from 'react'
import { qrMatrix, qrToRgba } from '@/lib/qr'

/** T-149: QR code for the quote link, drawn in the browser, with a PNG download. */
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

  function download() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`QR code for ${value}`}
        className="h-44 w-44 rounded-warm-lg border border-border bg-white"
      />
      <div className="text-center sm:text-left">
        <p className="text-sm text-text-secondary">
          Put it on your van, flyers, business cards or invoices. Customers point their phone camera at it and land on
          your quote page.
        </p>
        <button
          type="button"
          onClick={download}
          className="mt-3 inline-flex items-center rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-semibold text-text-primary hover:bg-surface"
        >
          Download PNG
        </button>
      </div>
    </div>
  )
}
