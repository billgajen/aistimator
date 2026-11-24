// T-201 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// One section per part of the ticket, each in scripts/hardcore-test/t201/:
//   reminder   the follow-up reminder switch (item 4)
//   services   the service editor (items 5 to 10, 12)
//   estimates  the quote link and estimates (items 11, 15 to 20, 27, 28)
//   home       Home, Settings, Analytics, WhatsApp, Branding (items 13, 14, 21 to 26, 30, 35)
//   billing    service area, the badge, held requests, the free allowance, customer emails (29, 31 to 34)
//
// Part A (the Android app) has no server side: unit tests in apps/mobile and the owner's phone.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t201.mts            (every section)
//               npx tsx scripts/hardcore-test/verify-t201.mts services   (one or more, by name)
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off.
import { h, finish } from './t201/harness.mts'

const SECTIONS = ['reminder', 'services', 'estimates', 'home', 'billing'] as const
const asked = process.argv.slice(2)
const unknown = asked.filter((name) => !(SECTIONS as readonly string[]).includes(name))
if (unknown.length) {
  console.error(`No such section: ${unknown.join(', ')}. Sections: ${SECTIONS.join(', ')}`)
  process.exit(2)
}

for (const name of SECTIONS) {
  if (asked.length && !asked.includes(name)) continue
  const { run } = (await import(`./t201/${name}.mts`)) as { run: (harness: typeof h) => Promise<void> }
  try {
    await run(h)
  } catch (error) {
    // a section that stops early is one failed check, and the others still run
    h.check(`(the "${name}" section ran to its end)`, false, error instanceof Error ? error.message : String(error))
  }
}
process.exit(finish())
