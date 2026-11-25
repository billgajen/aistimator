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

/** The ink a QR code is drawn in (the same in the picture and the vector) */
export const QR_INK = '#1B2823'

/**
 * T-204: the same code as a vector (SVG), sharp at any size: a van's side, a
 * banner, a printer's file. One unit per module, the same quiet zone as the
 * PNG, a white ground, and each row's dark runs as one path, so the file is
 * small and no hairlines show between modules. `size` is the width and height
 * it opens at; it scales without loss.
 */
export function qrToSvg(matrix: boolean[][], margin = 4, size = 1024): string {
  const modules = matrix.length + margin * 2
  let path = ''
  matrix.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      let run = 1
      while (c + run < row.length && row[c + run]) run++
      path += `M${c + margin} ${r + margin}h${run}v1h-${run}z`
      c += run
    }
  })
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${modules} ${modules}" shape-rendering="crispEdges">` +
    `<rect width="${modules}" height="${modules}" fill="#FFFFFF"/>` +
    `<path d="${path}" fill="${QR_INK}"/>` +
    `</svg>\n`
  )
}

/** The dark modules a vector made by `qrToSvg` draws, read back from its path (for the checks) */
export function svgToMatrix(svg: string, margin = 4): boolean[][] {
  const modules = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1] ?? 0)
  const n = modules - margin * 2
  const matrix = Array.from({ length: Math.max(0, n) }, () => Array.from({ length: Math.max(0, n) }, () => false))
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i++) {
      const row = matrix[Number(y) - margin]
      if (row) row[Number(x) - margin + i] = true
    }
  }
  return matrix
}
