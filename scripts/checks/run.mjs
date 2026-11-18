#!/usr/bin/env node
// The project's checks, at two levels, with one command each (T-183). Docs/testing.md has the detail.
//
//   pnpm check:quick     lint, typecheck, unit tests, the two builds, then the verify scripts
//                        that ask no AI model and need no specially started servers, side by
//                        side, against the built web app and a worker started with the AI
//                        stand-in (neither asks a model). Every ticket.
//   pnpm check:full      the same static checks and builds, then the whole regression set with
//                        the real model: the standard set side by side against the built web
//                        app, then each set that needs its own development servers, started and
//                        stopped in turn. When pricing, the worker, AI prompts, billing or the
//                        quote flow APIs change.
//   pnpm check:failed    only what failed in the last run, at that run's level.
//   pnpm check:setup     installs the browser tools the browser checks need, once.
//
// Options (after the level):
//   --only t156,t183   only these scripts (no static checks unless --static is given too)
//   --jobs 4           how many scripts run at once against the built web app (default 4)
//   --sets meta,t179   add these sets of servers to a quick run (all = every set); see manifest.mjs
//   --dev-server       serve every set from the development server, never a built web app
//   --no-static        skip lint, typecheck, unit tests and builds
//   --static           only lint, typecheck, unit tests and the two builds
//   --keep-servers     leave the last set of servers running when it ends
//   --no-retry         do not give a script that failed beside others a second try alone
//   list               print every script and what it needs, and any verify script not listed
//
// Plain Node, no dependencies. It starts and stops the web app (port 3000) and the worker (8787)
// itself, and refuses to start if either port is already taken: it never stops a server it did not
// start. The local database (supabase) must be running; this does not start it.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCRIPTS, SERVERS, STATIC_STEPS, BUILD_STEPS, WEB_BUILD_STEP } from './manifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'scripts/hardcore-test/results/checks')
const LAST = path.join(OUT, 'last.json')
const BROWSER_DIR = process.env.PLAYWRIGHT_DIR || path.join(ROOT, '.checks/browser')
const WEB_PORT = 3000
const WORKER_PORT = 8787

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name) => argv.includes(`--${name}`)
const option = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i > -1 ? argv[i + 1] : undefined
}
const only = option('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const jobs = Math.max(1, Number(option('jobs')) || 4)

const say = (line = '') => process.stdout.write(`${line}\n`)
const seconds = (ms) => `${Math.round(ms / 1000)} s`
const clock = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : seconds(ms))

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function listeners(port) {
  try {
    return execFileSync('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return [] // lsof exits 1 when nothing listens
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what, test, { tries = 90, everyMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await test().catch(() => false)) return
    await sleep(everyMs)
  }
  throw new Error(`${what} did not come up`)
}

function parseEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/** Run a command to its end, its output to a log file. Resolves with the exit code. */
function run(commandName, args, { cwd = ROOT, env = process.env, log, minutes = 10 }) {
  return new Promise((resolve) => {
    const fd = openSync(log, 'w')
    const child = spawn(commandName, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true })
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      resolve({ code: 124, timedOut: true })
    }, minutes * 60_000)
    running.add(child)
    child.on('exit', (code) => {
      clearTimeout(timer)
      running.delete(child)
      closeSync(fd)
      resolve({ code: code ?? 1, timedOut: false })
    })
    child.on('error', () => {
      clearTimeout(timer)
      running.delete(child)
      resolve({ code: 127, timedOut: false })
    })
  })
}

const running = new Set()
const servers = []

function stopGroup(child) {
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
}

async function stopServers() {
  for (const server of servers.splice(0)) stopGroup(server.child)
  // a dev server leaves children behind: whatever still listens on our ports is ours (the ports were free when we started)
  for (let i = 0; i < 10 && (listeners(WEB_PORT).length || listeners(WORKER_PORT).length); i++) {
    await sleep(1000)
    if (i >= 2) for (const pid of [...listeners(WEB_PORT), ...listeners(WORKER_PORT)]) try { process.kill(Number(pid), i >= 6 ? 'SIGKILL' : 'SIGTERM') } catch { /* gone */ }
  }
}

let stopping = false
async function stopEverything(code) {
  if (stopping) return
  stopping = true
  for (const child of running) stopGroup(child)
  if (!flag('keep-servers')) await stopServers()
  process.exit(code)
}
process.on('SIGINT', () => void stopEverything(130))
process.on('SIGTERM', () => void stopEverything(143))

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

function startServer(name, commandName, args, { cwd, env, log }) {
  const fd = openSync(log, 'w')
  const child = spawn(commandName, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true })
  servers.push({ name, child })
  child.on('exit', () => closeSync(fd))
  return child
}

/**
 * Start one set of servers and wait until they answer.
 * At the quick level neither server asks an AI model: the web app is given no model key, and the
 * worker is started with AI_STAND_IN=off (honoured in local development only).
 */
async function startServers(serverId, level, dir, record) {
  const set = SERVERS[serverId]
  const built = usesBuiltApp(serverId)
  const busy = [WEB_PORT, ...(set.worker === false ? [] : [WORKER_PORT])].filter((port) => listeners(port).length > 0)
  if (busy.length) {
    throw new Error(`Port ${busy.join(' and ')} is already in use. Stop the server running there and run this again (this never stops a server it did not start).`)
  }
  const webLog = path.join(dir, `web-${serverId}.log`)
  const webEnv = { ...process.env }
  for (const [name, value] of Object.entries(set.web)) {
    if (value === undefined) delete webEnv[name]
    else webEnv[name] = value
  }
  if (level === 'quick') {
    webEnv.GEMINI_API_KEY = ''
    webEnv.ANTHROPIC_API_KEY = ''
  }
  if (built) {
    // Build with the settings it will run with (the public ones are fixed at build time), then serve the build.
    // A request waits for its price, as it does on the development server (in production a queue prices it).
    webEnv.SYNC_QUOTE_PROCESSING = 'true'
    const log = path.join(dir, `${WEB_BUILD_STEP.id}.log`)
    const started = Date.now()
    const { code, timedOut } = await run(WEB_BUILD_STEP.command, WEB_BUILD_STEP.args, { env: webEnv, log, minutes: WEB_BUILD_STEP.minutes })
    record({ id: WEB_BUILD_STEP.id, kind: 'static', ok: code === 0, code, timedOut, ms: Date.now() - started, log: path.relative(ROOT, log) })
    if (code !== 0) throw new Error('the web app did not build')
    const patterns = builtPatternCheck(path.join(dir, 'built-patterns.log'))
    record(patterns)
    if (!patterns.ok) throw new Error('the built web app holds a pattern the build changed (see built-patterns.log)')
    startServer('web', 'pnpm', ['--filter', '@qolumns/web', 'exec', 'next', 'start', '-p', String(WEB_PORT)], { cwd: ROOT, env: webEnv, log: webLog })
  } else {
    startServer('web', 'pnpm', ['dev:web'], { cwd: ROOT, env: webEnv, log: webLog })
  }

  if (set.worker !== false) {
    const vars = { ...set.worker, ...(level === 'quick' ? { AI_STAND_IN: 'off' } : {}) }
    const args = ['wrangler', 'dev', '--port', String(WORKER_PORT), ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])]
    startServer('worker', 'npx', args, { cwd: path.join(ROOT, 'apps/worker'), env: process.env, log: path.join(dir, `worker-${serverId}.log`) })
  }

  await waitFor('The web app', async () => (await fetch(`http://localhost:${WEB_PORT}/login`, { signal: AbortSignal.timeout(60_000) })).status === 200)
  if (set.worker !== false) {
    const wanted = level === 'quick' ? 'stand-in' : 'model'
    await waitFor('The worker', async () => {
      const health = await (await fetch(`http://localhost:${WORKER_PORT}/health`, { signal: AbortSignal.timeout(10_000) })).json()
      if (health.ai !== wanted) throw new Error(`the worker on ${WORKER_PORT} reports AI "${health.ai}", not "${wanted}"`)
      return health.status === 'ok'
    })
  }
  return webLog
}

/**
 * A fault the production build has made once (T-183): a pattern written as a string with an escaped
 * backslash before a letter, such as "\\b" for a word edge, came out of the build as a string holding
 * a control character (a backspace) instead, so the pattern matched nothing, silently, in the built
 * app only. Unit tests and the development server never see it. So every built web app is read: in
 * a `RegExp("…")` the build wrote, an odd number of backslashes before b, f or v is a control
 * character inside a pattern, which no pattern of ours means.
 */
function builtPatternCheck(log) {
  const started = Date.now()
  const found = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) {
        const text = readFileSync(full, 'utf8')
        for (const match of text.matchAll(/RegExp\((["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
          for (const run of match[2].matchAll(/(\\+)([bfv])/g)) {
            if (run[1].length % 2 === 1) found.push(`${path.relative(ROOT, full)}: RegExp(${match[1]}${match[2].slice(0, 120)}${match[1]})`)
          }
        }
      }
    }
  }
  for (const part of ['server', 'static']) {
    const folder = path.join(ROOT, 'apps/web/.next', part)
    if (existsSync(folder)) walk(folder)
  }
  const unique = [...new Set(found)]
  writeFileSync(log, unique.length ? `A pattern in the built web app holds a control character where a backslash escape was written:\n${unique.join('\n')}\n` : 'No pattern in the built web app was changed by the build.\n')
  return { id: 'built-patterns', kind: 'static', ok: unique.length === 0, code: unique.length ? 1 : 0, timedOut: false, ms: Date.now() - started, log: path.relative(ROOT, log) }
}

// ---------------------------------------------------------------------------
// One verify script
// ---------------------------------------------------------------------------

/** "54/54 pass" (most scripts) or "104 of 104 checks passed." (verify-t173) */
function resultLine(log) {
  const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
  const all = [...text.matchAll(/^(\d+)\/(\d+) pass/gm), ...text.matchAll(/^(\d+) of (\d+) checks passed/gm)]
  const last = all.sort((a, b) => a.index - b.index).pop()
  return last ? { passed: Number(last[1]), total: Number(last[2]) } : null
}

async function runScript(script, level, webLog, dir) {
  const log = path.join(dir, `${script.id}.log`)
  const started = Date.now()
  const { code, timedOut } = await run('npx', ['tsx', `scripts/hardcore-test/verify-${script.id}.mts`], {
    env: { ...process.env, WEB_LOG: webLog, PLAYWRIGHT_DIR: BROWSER_DIR, CHECK_LEVEL: level },
    log,
    minutes: script.minutes ?? 10,
  })
  const counts = resultLine(log)
  const ok = code === 0 && counts !== null && counts.passed === counts.total && counts.total > 0
  return { id: script.id, kind: 'script', ok, code, timedOut, ...(counts ?? {}), ms: Date.now() - started, log: path.relative(ROOT, log) }
}

/** Run a group's scripts, `atOnce` at a time; two scripts in the same lane never run together. */
async function runPool(scripts, atOnce, worker) {
  const queue = [...scripts]
  const busyLanes = new Set()
  const results = []
  let active = 0
  await new Promise((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) return resolve()
      while (active < atOnce) {
        const i = queue.findIndex((s) => !s.lane || !busyLanes.has(s.lane))
        if (i === -1) break
        const [script] = queue.splice(i, 1)
        if (script.lane) busyLanes.add(script.lane)
        active++
        worker(script).then((result) => {
          results.push(result)
          if (script.lane) busyLanes.delete(script.lane)
          active--
          next()
        })
      }
    }
    next()
  })
  return results
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function listCommand() {
  const onDisk = readdirSync(path.join(ROOT, 'scripts/hardcore-test'))
    .map((f) => /^verify-(t\d+)\.mts$/.exec(f)?.[1])
    .filter((id) => id && Number(id.slice(1)) >= 146)
  say('Script  Servers   Quick  Notes')
  for (const s of SCRIPTS) {
    const notes = [s.browser ? 'browser' : '', s.lane ? `lane ${s.lane}` : '', s.external ? `talks to ${s.external}` : '', s.model === 'real' ? 'needs the real model' : '', SERVERS[s.server].devOnly ? 'needs its own development servers' : ''].filter(Boolean).join(', ')
    say(`${s.id.padEnd(7)} ${s.server.padEnd(9)} ${(inQuick(s) ? 'yes' : 'no').padEnd(6)} ${notes}`)
  }
  const missing = onDisk.filter((id) => !SCRIPTS.some((s) => s.id === id))
  const gone = SCRIPTS.filter((s) => !onDisk.includes(s.id)).map((s) => s.id)
  if (missing.length) say(`\nNOT LISTED in scripts/checks/manifest.mjs (never run): ${missing.join(', ')}`)
  if (gone.length) say(`\nListed, but the file is missing: ${gone.join(', ')}`)
  process.exit(missing.length || gone.length ? 1 : 0)
}

/** Sets named with --sets are added to a quick run (all = every set); otherwise the quick level is the sets that need no development server */
const extraSets = option('sets')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
const setInQuick = (serverId) => !SERVERS[serverId].devOnly || extraSets.includes('all') || extraSets.includes(serverId)
const inQuick = (s) => s.model === 'none' && !s.external && setInQuick(s.server)
/** A set that needs no development-only stand-in is served from a built web app, at both levels */
const usesBuiltApp = (serverId) => !SERVERS[serverId].devOnly && !flag('dev-server')

function setupCommand() {
  mkdirSync(BROWSER_DIR, { recursive: true })
  if (!existsSync(path.join(BROWSER_DIR, 'package.json'))) writeFileSync(path.join(BROWSER_DIR, 'package.json'), `${JSON.stringify({ name: 'checks-browser-tools', private: true }, null, 2)}\n`)
  say(`Installing the browser tools into ${path.relative(ROOT, BROWSER_DIR) || BROWSER_DIR} (playwright, pngjs, jsqr) …`)
  execFileSync('npm', ['install', '--no-audit', '--no-fund', 'playwright', 'pngjs', 'jsqr'], { cwd: BROWSER_DIR, stdio: 'inherit' })
  execFileSync('npx', ['playwright', 'install', 'chromium'], { cwd: BROWSER_DIR, stdio: 'inherit' })
  say('Done.')
  process.exit(0)
}

async function main() {
  if (command === 'list') return listCommand()
  if (command === 'setup') return setupCommand()

  let level = command
  let previous = null
  if (command === 'failed') {
    if (!existsSync(LAST)) throw new Error('There is no last run to take the failures from.')
    previous = JSON.parse(readFileSync(LAST, 'utf8'))
    level = previous.level
  }
  if (level !== 'quick' && level !== 'full') {
    say('Usage: node scripts/checks/run.mjs quick | full | failed | list | setup   (see the top of this file)')
    process.exit(2)
  }

  const failedBefore = previous ? new Set(previous.results.filter((r) => !r.ok).map((r) => r.id)) : null
  if (failedBefore && failedBefore.size === 0) {
    say('Nothing failed in the last run.')
    process.exit(0)
  }
  const wanted = (id) => (failedBefore ? failedBefore.has(id) : only ? only.includes(id) : true)

  const dir = path.join(OUT, level)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const startedAt = Date.now()
  const results = []
  const record = (result) => {
    results.push(result)
    const counts = result.total !== undefined ? ` ${result.passed}/${result.total}` : ''
    say(`${result.ok ? 'ok  ' : 'FAIL'} ${result.id.padEnd(14)}${counts.padEnd(9)} ${seconds(result.ms).padStart(6)}${result.ok ? (result.retried ? '   on the second try, alone' : '') : `   ${result.timedOut ? 'stopped: took too long. ' : ''}see ${result.log}`}`)
  }

  // ---- 1. Lint, typecheck, unit tests (and the builds at the full level) ----
  // the web app is built when the standard set's servers start (they serve that build); a run of the
  // static checks alone builds it here
  const staticSteps = [...STATIC_STEPS, ...BUILD_STEPS, ...(flag('static') ? [WEB_BUILD_STEP] : [])].filter((step) => wanted(step.id))
  const runStatic = failedBefore ? true : flag('static') || (!flag('no-static') && !only)
  if (runStatic && staticSteps.length) {
    say('\nLint, typecheck, unit tests, builds')
    for (const step of staticSteps) {
      const log = path.join(dir, `${step.id}.log`)
      const started = Date.now()
      const { code, timedOut } = await run(step.command, step.args, { log, minutes: step.minutes ?? 10 })
      record({ id: step.id, kind: 'static', ok: code === 0, code, timedOut, ms: Date.now() - started, log: path.relative(ROOT, log) })
    }
  }

  // ---- 2. The verify scripts ------------------------------------------------
  // a script named with --only is run at the level asked for, whatever level it is listed for
  const scripts = flag('static') ? [] : SCRIPTS.filter((s) => wanted(s.id) && (level === 'full' || Boolean(only) || inQuick(s)))
  if (scripts.length) {
    const local = parseEnvFile(path.join(ROOT, 'apps/web/.env.local'))
    const supabaseUrl = local.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
    const up = await fetch(`${supabaseUrl}/rest/v1/`, { headers: { apikey: local.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }, signal: AbortSignal.timeout(5000) }).then((r) => r.status < 500).catch(() => false)
    if (!up) throw new Error(`The local database does not answer at ${supabaseUrl}. Start it (pnpm db:start) and run this again.`)
    if (scripts.some((s) => s.browser) && !existsSync(path.join(BROWSER_DIR, 'node_modules/playwright'))) {
      throw new Error(`The browser checks need the browser tools in ${BROWSER_DIR}. Run "pnpm check:setup" once (or set PLAYWRIGHT_DIR to a folder that has playwright, pngjs and jsqr).`)
    }
  }
  for (const serverId of Object.keys(SERVERS)) {
    const group = scripts.filter((s) => s.server === serverId)
    if (group.length === 0) continue
    // on the development server pages are compiled when first asked for, and scripts side by side overload it
    const atOnce = usesBuiltApp(serverId) || option('jobs') ? Math.min(jobs, group.length) : 1
    say(`\nServers "${serverId}" (${level === 'quick' ? 'AI stand-in: no model is asked' : 'the real model'}; ${usesBuiltApp(serverId) ? 'the built web app' : 'the development server'}): ${group.length} script${group.length === 1 ? '' : 's'}, ${atOnce === 1 ? 'one at a time' : `up to ${atOnce} at once`}`)
    const t0 = Date.now()
    let webLog
    try {
      webLog = await startServers(serverId, level, dir, record)
    } catch (error) {
      await stopServers()
      for (const s of group) record({ id: s.id, kind: 'script', ok: false, code: 1, timedOut: false, ms: 0, log: `(servers did not start: ${error.message})` })
      continue
    }
    say(`  servers ready in ${seconds(Date.now() - t0)}`)
    // A script that failed while others ran beside it gets one more try, alone. The local web app
    // compiles a page the first time it is asked for, and two scripts asking for uncompiled pages at
    // once can get a 500 that has nothing to do with the product. A real failure fails again alone.
    // A pass on the second try is reported as such, never as a plain pass.
    const alone = atOnce > 1 && !flag('no-retry')
    const again = []
    await runPool(group, atOnce, async (script) => {
      const result = await runScript(script, level, webLog, dir)
      if (result.ok || !alone) record(result)
      else {
        say(`…    ${result.id.padEnd(14)}${(result.total !== undefined ? ` ${result.passed}/${result.total}` : '').padEnd(9)} ${seconds(result.ms).padStart(6)}   failed beside others; it will be tried alone`)
        again.push({ script, result })
      }
      return result
    })
    for (const { script, result } of again) {
      const firstLog = path.join(dir, `${script.id}.first-try.log`)
      try { writeFileSync(firstLog, readFileSync(path.join(dir, `${script.id}.log`))) } catch { /* no log */ }
      const second = await runScript(script, level, webLog, dir)
      record({ ...second, retried: true, firstTry: { passed: result.passed, total: result.total, log: path.relative(ROOT, firstLog) } })
    }
    if (!(flag('keep-servers') && serverId === Object.keys(SERVERS).filter((id) => scripts.some((s) => s.server === id)).pop())) await stopServers()
  }

  // ---- 3. The result --------------------------------------------------------
  const failed = results.filter((r) => !r.ok)
  const checks = results.reduce((sum, r) => sum + (r.passed ?? 0), 0)
  const scriptCount = results.filter((r) => r.kind === 'script').length
  const skipped = level === 'quick' && !only && !failedBefore ? SCRIPTS.filter((s) => !inQuick(s)).map((s) => s.id) : []
  if (!flag('static') && wanted(WEB_BUILD_STEP.id) && !results.some((r) => r.id === WEB_BUILD_STEP.id) && !only && !failedBefore) {
    // nothing started the standard set (no script of it was wanted), so the web app was not built
    say('Note: the web app was not built in this run.')
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(LAST, `${JSON.stringify({ level, at: new Date(startedAt).toISOString(), ms: Date.now() - startedAt, results }, null, 2)}\n`)

  say(`\n${level.toUpperCase()}: ${results.length - failed.length} of ${results.length} passed${scriptCount ? ` (${scriptCount} scripts, ${checks} checks)` : ''} in ${clock(Date.now() - startedAt)}`)
  const secondTry = results.filter((r) => r.ok && r.retried).map((r) => r.id)
  if (secondTry.length) say(`Passed only on a second try, alone (first-try logs are kept beside the others): ${secondTry.join(', ')}`)
  if (skipped.length) say(`Not run at this level (full level only): ${skipped.join(', ')}`)
  if (failed.length) {
    say(`Failed: ${failed.map((r) => r.id).join(', ')}`)
    say('Run only these again with: pnpm check:failed')
  }
  await stopEverything(failed.length ? 1 : 0)
}

main().catch(async (error) => {
  say(`\n${error.message}`)
  await stopEverything(1)
})
