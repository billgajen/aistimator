// The checks of the project, and what each needs (T-183). Docs/testing.md explains the two levels.
//
// Read by scripts/checks/run.mjs. Add a line here for every new verify script: a script that is not
// listed is never run, and `node scripts/checks/run.mjs list` says so.
//
// Every value below is a local test value, written in the scripts since the ticket named beside it.
// None is a secret, and none works outside this machine.

/** The web app's settings for the regression set (T-153 demo limits and cron; T-175 to T-177 the WhatsApp stand-in) */
const STANDARD_WEB = {
  CRON_SECRET: 'local-cron-t153',
  DEMO_DAILY_CAP: '8',
  DEMO_IP_LIMIT_PER_HOUR: '3',
  WHATSAPP_GRAPH_BASE_URL: 'http://127.0.0.1:8799',
  WHATSAPP_INTENT_BASE_URL: 'http://127.0.0.1:8799/ai',
  NEXT_PUBLIC_WHATSAPP_APP_ID: '900000000000175',
  NEXT_PUBLIC_WHATSAPP_CONFIG_ID: '900000000000176',
  WHATSAPP_APP_SECRET: 'local-app-secret-t175',
  WHATSAPP_VERIFY_TOKEN: 'local-verify-t175',
  WHATSAPP_ENCRYPTION_KEY: 'local-encryption-key-t175',
}

const DEMO_AND_CRON = { CRON_SECRET: 'local-cron-t153', DEMO_DAILY_CAP: '8', DEMO_IP_LIMIT_PER_HOUR: '3' }

/**
 * A set of servers. Scripts that share one run against the same web app and worker; the runner
 * starts each set once, runs its scripts, and stops it before the next.
 *   web      settings added to the web app's own (apps/web/.env.local)
 *   worker   false = no worker is started; otherwise `--var` settings for `wrangler dev`
 *   devOnly  the set needs the web app's development server: its scripts point the web app at
 *            their own stand-in for an outside service (Meta, Upstash, Turnstile, Postmark, a
 *            model), and the web app honours such an address only outside a production build.
 *            These sets are started one after another and their scripts run one at a time, so
 *            they are in the full level only (`--sets` adds them to a quick run).
 *
 * The `standard` set needs no such stand-in. At the quick level it is served from a built web app
 * (`next build`, then `next start`): pages answer at once instead of being compiled when first
 * asked for, which is what lets its scripts run side by side.
 */
export const SERVERS = {
  standard: { web: STANDARD_WEB, worker: {} },
  // T-175 to T-177: a stand-in for Meta and for the WhatsApp intent model (the scripts start it, on port 8799)
  meta: { web: STANDARD_WEB, worker: {}, devOnly: true },
  // T-173: its own stand-ins for Upstash, Turnstile and Postmark; with them on, other scripts fail
  t173: {
    web: {
      ...STANDARD_WEB,
      WHATSAPP_INTENT_BASE_URL: undefined,
      UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:8793/upstash',
      UPSTASH_REDIS_REST_TOKEN: 'local-upstash-t173',
      TURNSTILE_SECRET_KEY: 'local-turnstile-t173',
      TURNSTILE_VERIFY_URL: 'http://127.0.0.1:8793/turnstile/siteverify',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      POSTMARK_API_TOKEN: 'local-postmark-t173',
      POSTMARK_FROM_EMAIL: 'quotes@example.test',
      POSTMARK_API_BASE_URL: 'http://127.0.0.1:8793/postmark',
    },
    worker: {},
    devOnly: true,
  },
  // T-178: a stand-in for the service-match model and for Upstash (the quote link page's limit)
  t178: {
    web: { ...DEMO_AND_CRON, SERVICE_MATCH_BASE_URL: 'http://127.0.0.1:8797/ai', UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:8797/upstash', UPSTASH_REDIS_REST_TOKEN: 'local-upstash-t178' },
    worker: {},
    devOnly: true,
  },
  // T-179: stand-ins for the two models that read a customer's note
  t179: {
    web: { ...DEMO_AND_CRON, SERVICE_MATCH_BASE_URL: 'http://127.0.0.1:8796/match' },
    worker: { SECTION_AI_BASE_URL: 'http://127.0.0.1:8796/note' },
    devOnly: true,
  },
  // T-196: a stand-in for Expo's push service (the script starts it, on port 8792), for the web app and the worker
  t196: {
    web: { ...DEMO_AND_CRON, EXPO_PUSH_BASE_URL: 'http://127.0.0.1:8792/push' },
    worker: { EXPO_PUSH_BASE_URL: 'http://127.0.0.1:8792/push' },
    devOnly: true,
  },
  // T-180: a Postmark stand-in and no worker; it talks to the Stripe sandbox
  t180: {
    web: { CLOUDFLARE_WORKER_URL: '', POSTMARK_API_TOKEN: 'local-postmark-t180', POSTMARK_FROM_EMAIL: 'quotes@example.test', POSTMARK_API_BASE_URL: 'http://127.0.0.1:8794/postmark' },
    worker: false,
    devOnly: true,
  },
}

/**
 * The regression set: verify-t146 onwards (the older scripts are historical and are never run).
 *
 *   server   which set of servers it runs against. A script in a `devOnly` set is in the full
 *            level only.
 *   model    'none'  it asks no AI model for anything it checks: it runs at the quick level
 *            'real'  it checks something only a real model produces (a photo read, a note
 *                    understood, a price list compiled): it runs at the full level only
 *   lane     scripts in the same lane never run at the same time (they share a port or a row)
 *   browser  it drives a real browser (needs the browser tools: `pnpm check:setup`)
 *   minutes  the longest it may take before the runner stops it (default 10)
 *   external it talks to a service outside this machine, so it runs at the full level only
 */
export const SCRIPTS = [
  { id: 't146', server: 'standard', model: 'none' },
  { id: 't147', server: 'standard', model: 'none' },
  // T-148 checks a second round of questions, which only a quantity measured from photos starts
  { id: 't148', server: 'standard', model: 'real' },
  { id: 't149', server: 'standard', model: 'none', browser: true },
  { id: 't150', server: 'standard', model: 'none' },
  { id: 't151', server: 'standard', model: 'none' },
  { id: 't152', server: 'standard', model: 'none' },
  // T-153 checks that the demo reads a label off a sample photo
  { id: 't153', server: 'standard', model: 'real' },
  { id: 't154', server: 'standard', model: 'none', browser: true },
  { id: 't155', server: 'standard', model: 'none', browser: true },
  // T-156 presses the approval link against the built web app. Its wording case is what found the
  // banned-word pattern mis-compiled by the production build (T-183), so it stays at the quick level.
  { id: 't156', server: 'standard', model: 'none' },
  { id: 't157', server: 'standard', model: 'none', browser: true },
  { id: 't158', server: 'standard', model: 'none', browser: true },
  { id: 't160', server: 'standard', model: 'none', browser: true },
  { id: 't162', server: 'standard', model: 'none', browser: true },
  { id: 't164', server: 'standard', model: 'none', browser: true },
  { id: 't165', server: 'standard', model: 'none', browser: true },
  { id: 't167', server: 'standard', model: 'none', browser: true },
  // T-169 checks a label read from a photo and the quote checker's own log
  { id: 't169', server: 'standard', model: 'real', browser: true },
  { id: 't170', server: 'standard', model: 'none', browser: true },
  // T-171 walks the request form to a price that only a photo reading gives
  { id: 't171', server: 'standard', model: 'real', browser: true },
  // T-172 checks the quote checker's findings
  { id: 't172', server: 'standard', model: 'real', browser: true },
  { id: 't174', server: 'standard', model: 'none', browser: true },
  // T-175 to T-177 each start a stand-in for Meta on port 8799: one at a time
  { id: 't175', server: 'meta', model: 'none', browser: true, lane: 'meta' },
  { id: 't176', server: 'meta', model: 'none', browser: true, lane: 'meta' },
  { id: 't177', server: 'meta', model: 'none', browser: true, lane: 'meta' },
  { id: 't182', server: 'standard', model: 'none' },
  { id: 't183', server: 'standard', model: 'none' },
  { id: 't173', server: 't173', model: 'none', browser: true },
  { id: 't178', server: 't178', model: 'none', browser: true },
  { id: 't179', server: 't179', model: 'none', browser: true },
  { id: 't180', server: 't180', model: 'none', browser: true, external: 'the Stripe sandbox', minutes: 20 },
  // T-196 reads what the web app and the worker post to its stand-in for the push service
  { id: 't196', server: 't196', model: 'none', minutes: 20 },
  // T-197 has the real model sort problem reports, find a duplicate and match feature requests
  { id: 't197', server: 'standard', model: 'real', browser: true, minutes: 20 },
  // T-198 asks the Help assistant thirty-one questions with the real model and prints its score
  { id: 't198', server: 'standard', model: 'real', browser: true, minutes: 25 },
]

/** Lint, typecheck and unit tests: every level runs these first */
export const STATIC_STEPS = [
  { id: 'lint', command: 'pnpm', args: ['lint'] },
  { id: 'typecheck', command: 'pnpm', args: ['typecheck'] },
  { id: 'unit-worker', command: 'pnpm', args: ['--filter', '@qolumns/worker', 'test'] },
  // two workers: one file's test times out when the machine is busy with more
  { id: 'unit-web', command: 'pnpm', args: ['--filter', '@qolumns/web', 'exec', 'vitest', 'run', '--maxWorkers=2'] },
  { id: 'unit-mobile', command: 'pnpm', args: ['--filter', '@qolumns/mobile', 'test'] },
]

/**
 * The builds. Every level builds the worker here. The web app is built when the `standard` set
 * starts at the quick level (that build is what it serves); the full level builds it here.
 */
export const BUILD_STEPS = [{ id: 'build-worker', command: 'pnpm', args: ['build:worker'] }]
export const WEB_BUILD_STEP = { id: 'build-web', command: 'pnpm', args: ['build:web'], minutes: 15 }
