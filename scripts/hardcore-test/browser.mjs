// Browser checks (T-154, T-155) need playwright and pngjs, which the repo
// doesn't depend on. Install them once anywhere outside the repo, e.g.
//   mkdir -p ~/estimator-browser && cd ~/estimator-browser && npm i playwright pngjs && npx playwright install chromium
// and point PLAYWRIGHT_DIR at that folder when running a browser verify.
import { createRequire } from 'node:module'
import path from 'node:path'

export function browserDeps() {
  const dir = process.env.PLAYWRIGHT_DIR
  if (!dir) {
    console.error('Set PLAYWRIGHT_DIR to a folder with playwright and pngjs installed (see scripts/hardcore-test/browser.mjs).')
    process.exit(2)
  }
  const require = createRequire(path.join(path.resolve(dir), 'index.js'))
  return { chromium: require('playwright').chromium, PNG: require('pngjs').PNG }
}

export function checker() {
  const results = []
  const check = (name, pass, detail) => {
    results.push({ name, pass: Boolean(pass), detail })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
  const finish = () => {
    const failed = results.filter((r) => !r.pass)
    console.log(`\n${results.length - failed.length}/${results.length} pass`)
    process.exit(failed.length ? 1 : 0)
  }
  return { check, finish, results }
}

/** The marketing pages every layout check walks */
export const MARKETING_PAGES = [
  '/',
  '/pricing',
  '/features',
  '/trades',
  '/trades/hvac',
  '/trades/water-heaters',
  '/trades/plumbing',
  '/trades/electrical',
  '/trades/garage-doors',
  '/painting',
  '/demo',
  '/privacy',
  '/terms',
]
