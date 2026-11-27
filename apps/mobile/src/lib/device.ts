/**
 * T-206: what the app calls the thing it runs on.
 *
 * The app was written for a phone and said "on this phone" where a quote is
 * kept on the device. On an iPad that reads wrong, so the Quotes screen says
 * "On this iPad" there (T-206), and since T-207 every other line in the app
 * says "this device". Kept free of React Native so a test can run it: the
 * screen hands in what `Platform` says.
 */
export type DeviceWord = 'iPad' | 'phone'

export function deviceWord(os: string, isPad: boolean): DeviceWord {
  return os === 'ios' && isPad ? 'iPad' : 'phone'
}

/**
 * A line written for any device ("Saved on this device.", T-207; or, before that, for a phone), said for
 * this one: "Saved on this iPad." on an iPad, "Saved on this phone." on a phone. Only the Quotes screen
 * does this, under its own heading "On this iPad" / "On this phone"; everywhere else the app says
 * "this device".
 */
export function forDevice(line: string, word: DeviceWord): string {
  return line.replace(/\bthis (?:phone|device)\b/g, `this ${word}`)
}
