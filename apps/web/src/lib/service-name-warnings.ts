/**
 * T-204: warnings about a service's name on "Test & Publish" (pure).
 *
 * One rule, as before: a name that promises a kind of work ("Repair", "Fix",
 * "Replace") while no price line mentions it. The match used to be a bare
 * substring, and the warning always said "Repair": "Water Heater Replacement"
 * was told its name includes "Repair". Now the name is matched by whole words,
 * and the warning names the word it found.
 *
 * The three words are plain English about what a job is, the same for every
 * business. Nothing here knows a trade or a service.
 */

/** The word in the name, and how a price line would mention the same work */
const PROMISES: ReadonlyArray<{ inName: RegExp; inLine: RegExp }> = [
  { inName: /\b(repairs?)\b/i, inLine: /\b(repair|fix)/i },
  { inName: /\b(fix(?:es)?)\b/i, inLine: /\b(repair|fix)/i },
  { inName: /\b(replace)\b/i, inLine: /\b(replac|install|new)/i },
]

export function nameWarnings(name: string, lines: ReadonlyArray<{ name?: string | null; description?: string | null }>): string[] {
  if (lines.length === 0) return []
  const warnings: string[] = []
  for (const { inName, inLine } of PROMISES) {
    const found = inName.exec(name)?.[1]
    if (!found) continue
    if (lines.some((line) => inLine.test(`${line.name ?? ''} ${line.description ?? ''}`))) continue
    const word = found.charAt(0).toUpperCase() + found.slice(1).toLowerCase()
    warnings.push(`Service name includes "${word}" but no price line mentions it. Customers will expect a price for it.`)
    break
  }
  return warnings
}
