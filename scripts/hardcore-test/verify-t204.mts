// T-204 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// One section per part of the ticket, each in scripts/hardcore-test/t204/:
//   pricing    the AC Tune-Up proof through "Test Your Pricing" and through real requests, details
//              from photos, the flags, the name warning, "Photos required", "Save and switch on",
//              "Add to this quote", and the "Photos could not be read" note (items 1 to 4, 7, 20, 29)
//   customer   the ZIP field, "Quote prepared for", "Download PDF", the waiting pages (6, 9, 10, 28)
//   emails     one width, the status line, the answer to a question, the question email (11 to 15)
//   dashboard  Home and Quotes by themselves, the trace, the branding preview, unfinished requests,
//              analytics, the final invoice, several trades, the SVG code (17 to 19, 21 to 25)
//
// Not here: the compile with a real model (scripts/hardcore-test/t204/compile-live.mts, by hand),
// the overflow proof (scripts/load-test/overflow-proof.mts, by hand), the clarifying question's
// wording and the phone app (unit tests), and item 16 (a note for the owner).
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t204.mts            (every section)
//               npx tsx scripts/hardcore-test/verify-t204.mts pricing    (one or more, by name)
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off. The harness is T-201's.
import { h, finish } from './t201/harness.mts'

const SECTIONS = ['pricing', 'customer', 'emails', 'dashboard'] as const
const asked = process.argv.slice(2)
const unknown = asked.filter((name) => !(SECTIONS as readonly string[]).includes(name))
if (unknown.length) {
  console.error(`No such section: ${unknown.join(', ')}. Sections: ${SECTIONS.join(', ')}`)
  process.exit(2)
}

for (const name of SECTIONS) {
  if (asked.length && !asked.includes(name)) continue
  const { run } = (await import(`./t204/${name}.mts`)) as { run: (harness: typeof h) => Promise<void> }
  try {
    await run(h)
  } catch (error) {
    // a section that stops early is one failed check, and the others still run
    h.check(`(the "${name}" section ran to its end)`, false, error instanceof Error ? error.message : String(error))
  }
}
process.exit(finish())
