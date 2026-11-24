/**
 * T-201: the service-area box in Settings, to and from the saved list. Pure.
 *
 * Postal codes are separated by commas or new lines. A "County/State" entry
 * can hold a comma of its own ("Harris County, TX": the county, then its
 * state), so those are one to a line (a semicolon also separates two).
 */
export function parseAreaInput(text: string, mode: string): string[] {
  const separator = mode === 'county_state' ? /[;\n]/ : /[,\n]/
  return text
    .split(separator)
    .map((value) => value.replace(/\s+/g, ' ').trim().replace(/,$/, '').trim())
    .filter((value) => value.length > 0)
}

export function formatAreaInput(values: readonly string[] | null | undefined, mode: string): string {
  return (values ?? []).join(mode === 'county_state' ? '\n' : ', ')
}

/** The line under the box */
export function areaInputHint(mode: string): string {
  return mode === 'county_state'
    ? 'Put each on its own line. Write a county with its state, like "Harris County, TX". A ZIP code tells us the state, not the county: a request from another state is turned away, and one we cannot place is let through.'
    : 'Separate multiple values with commas or put each on a new line'
}
