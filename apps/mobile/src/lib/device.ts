/**
 * T-206: what the app calls the thing it runs on.
 *
 * The app was written for a phone and says "on this phone" where a quote is
 * kept on the device. On an iPad that reads wrong, so the Quotes screen says
 * "On this iPad" there. Kept free of React Native so a test can run it: the
 * screen hands in what `Platform` says.
 */
export type DeviceWord = 'iPad' | 'phone'

export function deviceWord(os: string, isPad: boolean): DeviceWord {
  return os === 'ios' && isPad ? 'iPad' : 'phone'
}

/** A line written for a phone, said for this device ("Saved on this phone." → "Saved on this iPad.") */
export function forDevice(line: string, word: DeviceWord): string {
  return word === 'phone' ? line : line.replace(/\bthis phone\b/g, `this ${word}`)
}
