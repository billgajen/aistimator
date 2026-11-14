# Design skills (T-161)

Three Claude Code skills, installed for this project only, in `.claude/skills/`. They **advise**. They do not
decide: our colours, fonts and tokens ("The Measured Document", `apps/web/src/app/globals.css`) stay unless the
owner changes them in a ticket of their own.

| Skill (folder) | Repo | Commit | Licence | Version |
|---|---|---|---|---|
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill), path `skills/taste-skill` | `f6b76575f949707b4e3c37cd86cb44b0b98643e8` (2026-11-07) | MIT, © 2026 Leonxlnx | tasteskill 2.5.1 |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), path `.claude/skills/ui-ux-pro-max` | `6ae86f61f520d6ca229d2f40e070410638c908c5` (2026-11-10) | MIT, © 2024 Next Level Builder | |
| `design-motion-principles` | [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles), path `skills/design-motion-principles` | `4a9ca879f24a361f4dca4174fe2da0f67b5ddee3` (2026-05-30) | MIT, © 2026 Kyle Zantos | |

Content hashes the `skills` CLI computed (its `skills-lock.json`, not kept in the repo):
taste `b10eab0a…70c7fc`, ui-ux-pro-max `ff6863fc…dc0cc`, motion `afbcdb7f…d0735`.

## What we use each one for

- **taste (`design-taste-frontend`)**: the structure and imagery of the marketing pages. Which sections a page
  has, what each screen shows (real product UI, real photographs), the hero's entrance and the hover layer.
  Our pages are the skill's **software** kind (`site-kind software`).
- **ui-ux-pro-max**: UX rules (its 120 guidelines, `references/quick-reference.md`), chart choice for Home and
  Analytics, and its pre-delivery checklist before a UI ticket ships. Later, **one** saved design-system file
  (`--persist`), and only from our own tokens, never its generated palette.
- **design-motion-principles**: where motion belongs and how fast. Weighting for us: dashboard = Emil primary
  (restraint, under 300 ms, nothing on frequent actions), Jakub secondary; marketing and customer pages =
  Jakub primary, Jhey selective.

## How they were installed

`npx -y skills add <repo> --skill <name> --agent claude-code -y --copy` was run in an **empty scratch git repo**,
not in this project. Run in the project, the CLI also writes `skills-lock.json` at the repo root, which is
outside `.claude/skills` and `Docs/design`. The three installed folders were then copied into
`.claude/skills/`. Each was checked with `diff -rq` against a fresh clone at the commit above: byte-identical.

To update one later, repeat the same way and record the new commit here.

### taste is not in git: reinstall it at `f6b7657`

`.claude/skills/design-taste-frontend/` is in `.gitignore` because it is 39 MB. The other two skills are
committed. On a fresh clone, run this from the repo root to put taste back exactly as audited. The `skills` CLI
always takes the latest commit, so pin it with git. These steps were tested; the result is byte-identical to
the audited copy.

```bash
tmp=$(mktemp -d)
git clone --filter=blob:none https://github.com/Leonxlnx/taste-skill "$tmp/taste-skill"
git -C "$tmp/taste-skill" checkout f6b76575f949707b4e3c37cd86cb44b0b98643e8
rm -rf .claude/skills/design-taste-frontend
cp -R "$tmp/taste-skill/skills/taste-skill" .claude/skills/design-taste-frontend
rm -rf "$tmp"
```

The folder name must stay `design-taste-frontend`: it is the skill's name, and its Stop hook looks for
`.claude/skills/design-taste-frontend/scripts/gate.mjs`.

**Never run `gate.mjs --start` or `start.mjs deal` in this repo.** Either one arms the Stop hook. An armed gate
can block Claude's turns for up to about 9.5 minutes each, and the deal replaces our tokens.

## What they need, and what this machine has

| Need | Skill | Here |
|---|---|---|
| Node 22+ | taste (scripts) | Node 22.23.4: ok |
| Chrome, Edge or Chromium | taste (checker, shots) | Google Chrome 157 in /Applications: ok |
| ffmpeg (optional) | taste (`photos.mjs fetch` WebP conversion) | **not installed**. Only matters if we fetch stand-in photographs with the skill. Not upgraded, not installed. |
| Python 3, standard library only | ui-ux-pro-max | Python 3.9.6: ok (search and `--design-system` ran) |
| nothing | design-motion-principles | no scripts; its HTML report is plain HTML |

Notes:
- **taste is 39 MB** (1,631 files: its component, effect and photo kit). If `.claude/skills` is ever committed,
  that is the weight to expect.
- taste's `moments.mjs` has no macOS Chrome path; it needs `CHROME_PATH` set. `effects.mjs` reads `CHROME`
  instead. Neither is needed for an audit.

## Script safety review (read before anything was run)

Every script the three skills ship was read before any was run. Nothing reads `.env`, `.env.local` or any dotfile.

**design-motion-principles:** no scripts. Its audit mode writes an HTML report to `motion-audits/` at the project
root and opens it in the browser. That is outside `Docs/design`, so this audit used its **terminal mode** (no file
written); the findings are in `audit.md`.

**ui-ux-pro-max** (`scripts/*.py`): standard library only, no network. Reads its own `data/*.csv` and the
`COLORTERM` variable. Writes only with `--persist`: `design-system/<project>/MASTER.md` under `--output-dir`, or
under the current folder when that flag is missing. Always pass `--output-dir`. Its `scripts/tests/` start
subprocesses; they were not run.

**design-taste-frontend** (Node). Read in full except `consistency.mjs` (11,485 lines), where every network,
process, file and env call was read in context.

- **It installs a `Stop` hook.** The skill's front matter runs `node scripts/gate.mjs --hook claude` at the end
  of every Claude turn once the skill is active in a session. In this repo today the gate finds no armed build
  (`.taste-skill/build.json`) and no `index.html`, so it exits at once, writes nothing and blocks nothing. It
  arms when someone runs `gate.mjs --start …` or `start.mjs deal …`. Armed, it can **block a turn for up to
  about 9.5 minutes** while it re-checks the page (up to 30 blocks in 6 hours), and writes `.taste-skill/` in
  the folder it runs from. **Rule: never run `gate.mjs --start` or `start.mjs deal` from this repo.** Its build
  pipeline (copying its kit into `public/assets`, dealing palettes and fonts) is for static sites and would
  replace our tokens.
- **Calls the network:**
  - `scripts/photos.mjs search|fetch`: Wikimedia Commons API, upload.wikimedia.org, picsum.photos.
  - `scripts/icons.mjs` (fetch, scan, find, check, measure): cdn.jsdelivr.net (Iconify, simple-icons, gilbarbara/logos).
  - `assets/components/fx-map/bake.mjs`: POSTs to overpass-api.de.
  - `consistency.mjs` fetches only the audited page's own origin, and only its local links.
  - Headless Chrome may make Chrome's own background calls; no flag turns them off.
  - **None of these were run except `consistency.mjs` against localhost.**
- **Writes outside the repo:** Chrome profiles and caches in the OS temp folder (`TASTE_SKILL_TMP` overrides);
  `shoot.mjs`, `check.mjs` and `moments.mjs` never delete their profile. Several maintenance subcommands
  (`moments.mjs index`, `effects.mjs publish`, `icons.mjs check --mark`) write into the skill's own folder.
  `start.mjs deal` can rewrite an armed `build.json` one or two folders **up**. `icons.mjs measure` deletes
  whatever folder is passed as `--profile`.
- **Processes:** it starts Chrome (headless, `--use-angle=swiftshader`) and stops it by its own PID or process
  group, never by name.
- **What was run for this audit:** `consistency.mjs` only, against `http://localhost:3000/…`, from a scratch
  folder, with an absolute `--profile` and `--out` and `TASTE_SKILL_TMP` in the scratch folder. Nothing was
  written to the repo. `assets/layout/check.mjs` was not run: it needs the skill's own `.wrap` markup, returns a
  single "container: no .wrap" finding on our pages, and crashes with `--shots`.

## Rules for using them here

1. The skills advise; tickets decide. A skill's palette, font pairing, radius or spacing scale is never applied
   without a ticket that says so (see `audit.md`, "Where a skill wants to change our tokens").
2. taste: use its references (`references/*.md`) and `consistency.mjs` against localhost from a scratch folder.
   Never its build pipeline, its kit files, `gate.mjs --start` or `start.mjs deal`. Never fetch photographs or
   icons with it without a ticket (licences, network).
3. ui-ux-pro-max: run from the scratchpad; `--persist` only with `--output-dir Docs/design`.
4. design-motion-principles: audit in terminal mode, or let it write its HTML into `Docs/design/` by hand, not
   `motion-audits/`.
