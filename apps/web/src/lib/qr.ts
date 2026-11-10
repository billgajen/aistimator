/**
 * T-149: QR code for the quote link, made in the browser (no external QR
 * service). `qrcode-generator` does the encoding; this turns its modules into
 * pixels, so the same code draws the on-screen code and the PNG download,
 * and a unit test can decode it.
 */
import qrcode from 'qrcode-generator'

/** Dark modules, row by row. Error correction M (survives a little damage or a logo-free print). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/**
 * RGBA pixels for a matrix: `scale` pixels per module and a `margin` of
 * light modules all round (the spec's quiet zone is 4).
 */
export function qrToRgba(matrix: boolean[][], scale = 10, margin = 4): { data: Uint8ClampedArray; size: number } {
  const modules = matrix.length + margin * 2
  const size = modules * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return
      for (let y = 0; y < scale; y++) {
        const py = (r + margin) * scale + y
        for (let x = 0; x < scale; x++) {
          const i = (py * size + (c + margin) * scale + x) * 4
          data[i] = 0x1b
          data[i + 1] = 0x28
          data[i + 2] = 0x23 // ink #1B2823 — dark enough for any scanner
        }
      }
    })
  )
  return { data, size }
}
