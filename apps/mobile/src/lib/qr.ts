/**
 * T-184: the modules of a QR code (pure). The same encoder and error
 * correction as the dashboard's code (apps/web/src/lib/qr.ts, T-149).
 */
import qrcode from 'qrcode-generator'

/** Dark modules, row by row. Error correction M, as on the dashboard. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** Each row as runs of dark and light, so a row is a handful of views and not one per module */
export function rowRuns(row: boolean[]): Array<{ dark: boolean; length: number }> {
  const runs: Array<{ dark: boolean; length: number }> = []
  for (const dark of row) {
    const last = runs[runs.length - 1]
    if (last && last.dark === dark) last.length++
    else runs.push({ dark, length: 1 })
  }
  return runs
}
