# Testing: two levels, one command each

Since T-183. The runner is `scripts/checks/run.mjs`; what each script needs is in `scripts/checks/manifest.mjs`.

| Level | Command | When | What it runs | Time on the owner's Mac |
|---|---|---|---|---|
| **Quick** | `pnpm check:quick` | every ticket | lint, typecheck, unit tests, the two builds, then the verify scripts that ask no AI model and need no specially started servers, four at once | 4 to 5½ minutes (three runs: 3 min 53 s, 5 min 26 s, 4 min 34 s) |
| **Full** | `pnpm check:full` | when pricing, the worker, AI prompts, billing, the quote flow APIs, emails or a migration change; at the end of a batch of design tickets; before launch | the same static checks and builds, then the whole regression set with the real model | about 35 minutes (one run: 35 min 8 s, of which 5 minutes were a script that hung after passing, fixed since) |

Also:

- `pnpm check:failed` runs again only what failed in the last run, at that run's level.
- `pnpm check:list` prints every script, its servers and whether it is in the quick level. It fails if a
  `verify-tNNN.mts` file (146 or later) is not in the manifest.
- `pnpm check:setup` installs the browser tools the browser checks need (playwright, pngjs, jsqr) into
  `.checks/browser`, which git ignores. Once per machine.

Options, after the level: `--only t156,t183` (just these scripts, at the level asked for, no static checks),
`--jobs 4` (how many scripts at once against the built web app), `--sets meta,t179` (add sets of servers to a
quick run; `all` adds every set), `--no-static`, `--static` (only lint, typecheck, unit tests and the builds),
`--dev-server` (never a built web app), `--no-retry`, `--keep-servers`.

```bash
pnpm check:quick                      # every ticket
pnpm check:quick --only t183          # one script while building
pnpm check:failed                     # after fixing what failed
pnpm check:full                       # before a ticket that touches pricing, the worker, prompts, billing or the quote flow is done
```

## What you need running

- The local database: `pnpm db:start` (see the note in the project memory about `supabase/.temp/postgres-version`).
  The runner checks it answers and stops with a plain message if it does not.
- **Nothing on ports 3000 and 8787.** The runner starts the web app and the worker itself, with the settings each
  set of scripts needs, and stops them when it ends. It refuses to start if either port is taken: it never stops a
  server it did not start.
- The full level needs the model key in `apps/web/.env.local` and `apps/worker/.dev.vars`, and (for `verify-t180`)
  the Stripe sandbox key. The quick level needs neither.
- The browser tools: `pnpm check:setup`, once.
- No other build or dev server of the web app at the same time: the runner builds into `apps/web/.next`.

To stop a run, send the runner the stop signal (Ctrl+C in its terminal). It stops the scripts and the servers it
started.

## The AI stand-in (the quick level)

At the quick level no AI model is asked for anything:

- **The worker** is started with `AI_STAND_IN=off` (`npx wrangler dev --var AI_STAND_IN:off`). Every part of the
  pipeline that would ask a model gets no client, and takes the path it already has for that (the same path as a
  missing key): no reading of photos, the built-in wording, no quote checker. A quote priced from the customer's
  answers comes out the same every time, in a second or two, at no cost. The switch is honoured only when
  `ENVIRONMENT` is `development` (`apps/worker/src/ai/client.ts`, `aiStandInOn`); in production it is ignored. The
  worker's `/health` says `"ai": "stand-in"` or `"ai": "model"`, and the runner checks it got the one it started.
- **The web app** is started with no model key, so its own small model calls (does another service fit the
  customer's words) are skipped, as they are when the key is missing.
- Scripts that need a model's answer to be a particular thing bring their own stand-in for that one call, as
  before (`verify-t175` to `t177` for Meta and the WhatsApp intent, `verify-t178` for the service match,
  `verify-t179` for the note reader).

What the quick level therefore does **not** prove: anything a real model produces. A photo measured, a label
read, a customer's note understood, a price list compiled from plain words, the wording a model writes. Those
are the full level's, and a live model's answers are still never a pass-or-fail check on their own
(`verify-t177-live.mts`, `verify-t179-live.mts` are optional and outside both levels).

## The built web app, and why it matters

The local development server (`next dev`) compiles each page the first time it is asked for, and it is one
process. Several scripts asking for pages at once overloaded it: page loads timed out, the local database
answered 504, and a page still being compiled answered 500. Run that way the scripts were no faster side by
side than one after another.

So the `standard` set is served from a **built** web app, at both levels: the runner runs `next build` with the
set's settings, then `next start`. Pages answer at once. A script that took one to three minutes takes 5 to 50
seconds, and four run side by side. The build is also the "web builds" quality gate, so it is not extra work.
It is closer to production than the development server is, which is what a regression run should be.

One thing is set for the built app so it behaves as local development does: `SYNC_QUOTE_PROCESSING=true` (a
request waits for its price; in production a queue prices it).

**It found a real fault the first time it ran** (T-183): the production build had changed the banned-word
pattern of the customer-language guard so that it matched nothing, in every built web app, which is what
production runs. The development server, the unit tests and the worker's build were all fine. So after every
build the runner also reads the built app for a pattern changed that way (`built-patterns` in the output): in a
`RegExp("…")` the build wrote, an odd run of backslashes before `b`, `f` or `v` is a control character inside a
pattern. **When writing a pattern from a string, do not put a backslash escape in a template string** whose
other parts are constants; write the character class out, or use a regex literal (CHANGELOG, KC-007).

## Sets of servers

A script runs against one set of servers. The runner starts each set once, runs its scripts, stops it, then
starts the next.

| Set | Scripts | Served by | In the quick level |
|---|---|---|---|
| `standard` | most of the set | the built web app; the worker | yes |
| `meta` | `verify-t175`, `t176`, `t177` | the development server | no |
| `t173` | `verify-t173` | the development server | no |
| `t178` | `verify-t178` | the development server | no |
| `t179` | `verify-t179` | the development server | no |
| `t180` | `verify-t180` | the development server, no worker | no (it talks to the Stripe sandbox) |
| `t196` | `verify-t196` | the development server; the worker | no |

**Why six sets need the development server:** their scripts point the web app at their own stand-in for an
outside service (Meta, Upstash, Turnstile, Postmark, a model, Expo's push service), and the web app honours such an address only
outside a production build. That rule is a safeguard and stays. So those sets are started one after another,
their scripts run one at a time, and they are in the full level. `pnpm check:quick --sets all` adds them to a
quick run when a ticket touches what they cover (WhatsApp, the protections, a request that could not be priced,
several services on one quote).

## What the quick level leaves out

Run `pnpm check:list` for the current list. At T-183, of 32 scripts, 20 are in the quick level. The other 12:

| Scripts | Why |
|---|---|
| `t148`, `t153`, `t169`, `t171`, `t172` | each checks something only a real model produces (marked `model: 'real'`) |
| `t173`, `t175`, `t176`, `t177`, `t178`, `t179` | each needs its own development servers (a `devOnly` set) |
| `t180` | the Stripe sandbox, and its own servers |
| `t196` (added by T-196) | its own development servers: it reads what the web app and the worker post to its stand-in for the push service. `pnpm check:quick --only t196 --sets t196` runs it alone in about 40 seconds |
| `t197` (added by T-197) | the real model: it sorts three sample problems, finds a duplicate, reads a wrong rate as "Your price setup" and matches two feature requests. It closes the open support items earlier runs left in the local database first, so the model compares only this run's own. It prints "What the model got wrong" at the end. No email is sent (the local web app has no email token) |
| `t198` (added by T-198) | the real model: the Help assistant is asked 33 questions, each with what a right answer must contain or must not (a how-to for each area of the guide, a plan question, things that are not live, a thing that does not exist, a price on a quote with a wrong rate, a refund, a legal question, another business, an attempt to change its rules, another language). It needs 85% right to pass, and prints **the score and every wrong answer word for word**. It also checks the hand-off to the team, the owner's Questions tab, the draft reply, and the home page's fixes. Screens go to `.checks/t198/` |

## T-199: no script of its own, and how to see an address locally

T-199 added no verify script (the ticket's rule). What it changed is held by unit tests (web `access-t199` and
`own-address-t199`, worker `addresses-t199`, app `access-t199`) and by checks added to scripts that already ran:

- `verify-t182` (quick): with the free quotes used and no plan, the app is told on-site quotes are off, the
  server refuses a new one with 403 `ONSITE_QUOTES_NOT_IN_PLAN` and saves nothing, and the rest of the app still
  answers. Its plan-limit part now runs on a plan that includes on-site quotes.
- `verify-t177` (the `meta` lane): a business on the free start is allowed WhatsApp and told which plan keeps
  it; "no plan" in that script now means no subscription **and** the free quotes used.
- `verify-t162` and `verify-t171`: the "Prepared with" line (and, in `t171`, the form's "Powered by" line) is
  checked for a business on Starter. A business on
  the free start works like Pro and has no such line, so a fixture that needs the line needs a Starter row.
- `verify-t152`, `t155`, `t165`, `t167`: the free offer's new words.

**A fixture rule that follows:** a business made with no subscription row is on the free start and has every Pro
feature until its tenth priced quote. A script that means "a business without Pro features" must give it a
Starter row, or use up its free quotes (a `usage_counters` row with `estimates_created` at the allowance).

To see a business's own address on this machine (it is off in both levels, as it is in production until the
owner switches it on):

```bash
# apps/web/.env.local:  NEXT_PUBLIC_OWN_ADDRESS_HOST=localhost:8799  and  ADDRESS_PROXY_KEY=<any value>
pnpm dev:web
cd apps/worker && npx wrangler dev -c wrangler.addresses.toml --port 8799 --var ADDRESS_PROXY_KEY:<the same value>
# then open http://<the business's address>.localhost:8799/
```

Take both settings out of `.env.local` again before a check run: with the host set, the dashboard offers the
address card, which the scripts' pictures of Home and of the Quote link page do not expect.

## Running at once

Against the built web app, scripts run four at a time (`--jobs`). Each makes its own businesses, so they do not
share data. Against the development server they run one at a time.

- `lane` in the manifest: scripts in the same lane never overlap, whatever the number of jobs. `verify-t175`,
  `t176` and `t177` each start a stand-in for Meta on port 8799, so they share the lane `meta`. A new script
  that changes something every business shares (a cron run, a global limit) must be given a lane with the
  scripts it would disturb.
- **A script that fails beside others is tried once more, alone.** A real failure fails again. A pass on the
  second try is printed as "on the second try, alone" and listed at the end; the first try's log is kept
  (`<id>.first-try.log`). It is never reported as a plain pass, and a script that often needs a second try has a
  fault of its own to find. (In the first full run, `verify-t164` needed one: it measures whether an animation
  is running, beside three other browsers.)

## Adding a script (every ticket)

1. Write `scripts/hardcore-test/verify-tNNN.mts`. It ends by printing `N/N pass` and exits 0 only when every
   check passed (copy the `check` and `finish` helpers of a recent script). **It must end with `process.exit`:**
   a script that started its own stand-in server and only closed it can stay open for minutes.
2. Add one line to `SCRIPTS` in `scripts/checks/manifest.mjs`: its set of servers (`standard` unless it needs a
   stand-in the web app honours only in development), and `model: 'none'` if it asks no model for anything it
   checks (then it runs at the quick level), or `model: 'real'` if it needs one.
3. Prefer `model: 'none'`: price from the customer's answers, put a stored fact on a row directly when the
   pipeline's unit tests already prove it is stored, and keep anything a live model writes out of the checks.
4. The script is given `WEB_LOG` (the web app's log file), `PLAYWRIGHT_DIR` (the browser tools) and `CHECK_LEVEL`
   (`quick` or `full`).
5. At the full level a live model reads the request. Keep the customer's words in step with their answers (a
   model given "two rooms" beside "100 square feet" asks which is meant, and it is right to), and if a question
   comes anyway, answer it as the customer would and carry on (`verify-t183` does).
6. Inside a browser callback (`page.evaluate`), do not declare a named function: the script runner adds a helper
   the page does not have. Pass the values in and use an inline arrow.
7. A new GET route that reads the database with the service client must read fresh (`noStore()` from
   `next/cache`). Next keeps and reuses such a read otherwise; `verify-t183` found a used approval link still
   showing its photos that way (CHANGELOG, KC-006).

## Reading the result

Each line is one step or script: `ok` or `FAIL`, its checks, its time. A failed line names its log
(`scripts/hardcore-test/results/checks/<level>/<id>.log`; the servers' logs are beside it). The last line is the
count and the total time. The run's results are kept in `scripts/hardcore-test/results/checks/last.json`, which is
what `pnpm check:failed` reads. The exit code is 0 only when everything passed.

## What is not in either level

- The scripts before `verify-t146`: historical, out of date since T-146, never run and never fixed.
- The mobile app on a device. `verify-t182` drives its API client and queue; since T-196 its screens are looked
  at in an iPhone simulator by hand (the recipe is in the project memory), which no level runs.
- Anything on production. Both levels run on this machine only.

## T-200: the Android app has no script; Part B has one

- **`verify-t200` (quick, no model, no browser):** Business is not offered (Pricing's two cards, the billing
  page's plans, Checkout's refusal, and a holder who still sees its plan); saving "Quote Template" keeps customer
  acceptance as set; a one-word question to the assistant is asked back and not counted; the log-in page is the
  form alone. `verify-t165` checks the log-in page in a browser at each width; `verify-t171` (full level) checks
  the billing page's centred pair.
- **The Android app is not checked on this machine.** There is no Android SDK, Java or emulator here. Its unit
  tests are `apps/mobile/src/__tests__/android-t200.test.ts`. To read what an Android build will contain without
  building it: `cd apps/mobile && npx expo prebuild -p android --no-install`, read
  `android/app/src/main/AndroidManifest.xml`, then delete `android/` and undo the two `scripts` lines prebuild
  rewrites in `package.json`. `npx expo export --platform android` proves the JavaScript bundles for Android.
- **A fixture that needs three plan cards no longer exists:** since T-200 two plans are offered.

## T-204: one script, four sections; the live compile

- **`verify-t204` (quick, no model, a browser):** `scripts/hardcore-test/verify-t204.mts` runs the sections in
  `scripts/hardcore-test/t204/` with T-201's harness: `pricing` (the AC Tune-Up proof through "Test Your
  Pricing" and through real requests, details from photos, the flags, "Photos required", "Save and switch on",
  "Add to this quote", the "Photos could not be read" note), `customer`, `emails` and `dashboard`. One alone:
  `npx tsx scripts/hardcore-test/verify-t204.mts pricing`.
- **The AC Tune-Up fixture** (`scripts/hardcore-test/t204/ac-tune-up.ts`) is the service exactly as the compiler
  wrote it for the test business, with the ticket's answers and prices. The worker's and the web's unit tests
  and the verify section all price the same thing. A `.ts` file, so that vitest and tsx both load it.
- **The live compile** asks the real model and is run by hand, not by the runner (its answer varies and it is
  slow): `npx tsx --tsconfig apps/web/tsconfig.json scripts/hardcore-test/t204/compile-live.mts --repeats 3`.
  It compiles the ticket's AC text, prices the four cases with the engine, and prints the time. `--thinking
  low|medium|high` and `--model <id>` try another setting (that is how item 5's comparison was made).
- **A script that loads web code with tsx** must not reach a file that imports by `@/` (plain tsx does not
  resolve it): `service-templates.ts` does, `onboarding-service.ts` and the packs do not. Or pass
  `--tsconfig apps/web/tsconfig.json`, as the live compile does.
- **Item 29 has no end-to-end check:** no script makes a real photo reading fail inside the running worker.
  Each step's report and the processor's decision are unit tests (`photos-unread-t204.test.ts`).

## T-203: stand-in AI providers, the load test, the overflow proof

- **`verify-t203` (quick, no model):** `scripts/hardcore-test/verify-t203.mts` starts one small HTTP server on
  port 8791 that stands in for both AI providers (a request's path names its case, and each case has a script of
  answers: 429, 503, 529, 400, or a real-shaped answer). The worker's own code runs in-process against it and
  the local database: the clients `createAiClient` makes (busy then an answer, Retry-After, overflow, busy on
  both, a real error, a busy photo read that its caller swallowed), `handleQuoteJob` with the real quote row
  (the count kept on the quote, the two bounds, the quote marked failed), a request priced by the real worker
  (the counts in its timings), `checkBusy` (the window's count and the hour limit, with a stand-in for sending),
  and the load test's refusals.
- **The stand-in addresses** are worker settings honoured only when `ENVIRONMENT` is "development":
  `AI_GEMINI_BASE_URL`, `AI_ANTHROPIC_BASE_URL`, and `AI_BUSY_WAITS_MS` ("40,80,120") for shorter waits. The
  script passes them to `createAiClient` itself; the worker the runner starts does not have them.
- **The load test** (`scripts/load-test/run.mts`, not a check, never run by the runner):
  `npx tsx scripts/load-test/run.mts --url http://localhost:3000 --n 25`. Start the worker with the real model
  (no `AI_STAND_IN`). The web app decides the path: `next dev` prices each request directly (the POST waits and
  there is no queue wait to report); with `SYNC_QUOTE_PROCESSING=false`, or a built app, requests go through the
  worker's local queue. Photos come from `test-assets/hardcore/` (git-ignored, on the owner's Mac only). It
  costs real model calls: about $0.31 for 25 (25 Nov 2026).
- **The overflow proof** (`scripts/load-test/overflow-proof.mts`, needs `ANTHROPIC_API_KEY` in
  `apps/worker/.dev.vars`): 11 fixed cases over the pipeline's four tasks, each run on the task's own model and
  on the candidate, under the pipeline's own time cap. Where each input and tolerance comes from:
  `extraction_pass`: a signals read of the demo's sample room (shape only) and a three-pass measurement of the
  S01 photos (18 to 72 sqm, the GB painting pack's envelope, `scenarios.mjs`); `identification`: the demo's
  water-heater label ("50 gal", "Natural gas", as verify-t153/t169/t171) and the two T-139 labels ("Medium";
  nothing from the blurred one); `adjudication`: the S01 photos with three fixed junior takeoffs (the same
  envelope); `wording`: verify-t172's spring fixture through wording and repair, verify-t148's three sentences
  through the rewriter, and verify-t172's three checker cases. There is no fixed set for add-on detection, the
  question gate, cross-service notes or recommendations, which share the `wording` client; the script says so.
  `--task <name>`, `--case <id>`, `--primary-only`, `--repeats <n>`. Exit 0 all proven, 1 a failure, 2 no key.

## T-202: one script, two sections; the icons

- **`verify-t202` (quick, no model, a browser):** `scripts/hardcore-test/verify-t202.mts` runs the sections in
  `scripts/hardcore-test/t202/` with T-201's harness: `tryit` (the test estimate from the signed-in session, the
  limit of five and its time, deleting a test, what a test never counts in, the share tick) and `fixes` ("Try
  again" as the phone app calls it through five tries, "Clear" asking first, the payment-failed sentence from
  real rows). One alone: `npx tsx scripts/hardcore-test/verify-t202.mts tryit`.
- **A test request in any script** is now made the way the dashboard makes it: `ownTest: true` in the body of
  `POST /api/public/quotes`, with the business's session cookie. There is no test link any more.
- **Icons:** `python3 scripts/make-icons.py` writes them from `brand/qolumns-letter.png` and records what it
  wrote in `brand/icons-made.json`; `apps/mobile/src/__tests__/icons-t202.test.ts` fails when the drawing and
  the record disagree. To look at old against new: `python3 scripts/make-icons.py --compare out.png <revision>`.

## T-201: one script, five sections

- **`verify-t201` (quick, no model, a browser for one section):** `scripts/hardcore-test/verify-t201.mts` runs the
  sections in `scripts/hardcore-test/t201/`, which share `harness.mts` (a business, a service priced from the form
  alone, a customer request, rows changed by hand). One section can be run alone:
  `npx tsx scripts/hardcore-test/verify-t201.mts services` (also `reminder`, `estimates`, `home`, `billing`). A
  section that stops early is one failed check and the others still run.
- **The reminder switch has no email to read here** (no email provider on this machine, so the daily job skips
  its reminder step). The `reminder` section asks the job's own question, `dueReminders`, of the real database
  for two businesses, one with the switch off.
- **A purchase pricing saved requests** goes through Stripe's webhook: `verify-t180` (full level, the Stripe
  sandbox) holds it; the `billing` section runs the same pricing run without Stripe.
- **Trying a deploy script against a copy at the migration before** (the lesson of migration 44): copy the local
  database (`pg_dump | psql` into a new database made from `template0`), undo the new migration in the copy, run
  the script with `MIGRATION_TEST_API` pointed at a small stand-in that runs each query on the copy, then run it
  a second time. Done for migration 50.
- **The Android bundle's manifest:** `unzip -p apps/mobile/build/<file>.aab base/manifest/AndroidManifest.xml |
  strings | grep -i -A2 'uses-feature\|hardware'` shows the "not required" lines of T-201.
