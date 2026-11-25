// T-202 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// One section per part of the ticket, each in scripts/hardcore-test/t202/:
//   tryit    the test estimate from setup and Home, and the "Share your quote link" tick (items 3 and 5)
//   fixes    "Try again" as the phone app calls it, "Clear" asks first, the payment-failed email (1, 4, 6)
//
// The icons (item 2) and the builds (item 7) have no server side: unit tests and the owner's eyes.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t202.mts          (every section)
//               npx tsx scripts/hardcore-test/verify-t202.mts tryit    (one or more, by name)
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off. The harness is T-201's.
import { h, finish } from './t201/harness.mts'

const SECTIONS = ['tryit', 'fixes'] as const
const asked = process.argv.slice(2)
const unknown = asked.filter((name) => !(SECTIONS as readonly string[]).includes(name))
if (unknown.length) {
  console.error(`No such section: ${unknown.join(', ')}. Sections: ${SECTIONS.join(', ')}`)
  process.exit(2)
}

for (const name of SECTIONS) {
  if (asked.length && !asked.includes(name)) continue
  const { run } = (await import(`./t202/${name}.mts`)) as { run: (harness: typeof h) => Promise<void> }
  try {
    await run(h)
  } catch (error) {
    // a section that stops early is one failed check, and the others still run
    h.check(`(the "${name}" section ran to its end)`, false, error instanceof Error ? error.message : String(error))
  }
}
process.exit(finish())
