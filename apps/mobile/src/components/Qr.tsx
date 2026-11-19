/**
 * T-184: a QR code drawn from plain views (no image, no extra native code),
 * for the business's quote link shown full screen to a customer on site
 * (T-149). The same encoder and error correction as the dashboard's code.
 */
import { useMemo } from 'react'
import { View } from 'react-native'
import { qrMatrix, rowRuns } from '../lib/qr'

export function Qr({ value, size, label }: { value: string; size: number; label: string }) {
  const matrix = useMemo(() => qrMatrix(value), [value])
  // the quiet zone the spec asks for: four modules of white all round
  const quiet = 4
  const module = Math.max(1, Math.floor(size / (matrix.length + quiet * 2)))
  const side = module * (matrix.length + quiet * 2)
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: side, height: side, padding: module * quiet, backgroundColor: '#FFFFFF' }}
    >
      {matrix.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: module }}>
          {rowRuns(row).map((run, i) => (
            // a code is black on white whatever the app's colours are: scanners need the contrast
            <View key={i} style={{ width: run.length * module, height: module, backgroundColor: run.dark ? '#000000' : '#FFFFFF' }} />
          ))}
        </View>
      ))}
    </View>
  )
}
