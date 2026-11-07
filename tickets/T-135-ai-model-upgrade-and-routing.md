# tickets/T-135-ai-model-upgrade-and-routing.md

## Goal
Get onto the current generation of AI models and make model choice configuration, not
code. Today `gemini-2.5-flash` is hardcoded in several places, and the docs still say
Gemini 1.5 Flash.

## In scope
- **One model registry** (e.g. `packages/shared/src/ai-models.ts` or an env-backed config):
  a task → provider + model map. Tasks: `extraction_pass`, `adjudication`, `compile`,
  `wording`, `chat_widget`, `service_match`, `identification` (for T-139). Overridable by env.
- Replace every hardcoded model string and URL (`widget/chat/route.ts`,
  `ai-draft/shared.ts`, `service-matcher.ts`, worker `ai/*`) with registry lookups.
- **Provider-agnostic interface** for vision + JSON calls (the adjudication tier already
  anticipates this). Implement Gemini fully. Add an Anthropic (Claude) adapter behind the
  same interface for adjudication and identification, usable by config switch.
- **Evaluate:** run the gauntlet with the current model and with each candidate newer
  model per task. Record accuracy, cost per quote and latency in a table in the CHANGELOG.
  Pick the defaults from the data.
- Keep a per-quote AI cost estimate in the trace (tokens × configured price).
- Fix the docs (CLAUDE.md, 00-v1-scope.md, README) to point at the registry instead of
  naming a model.

## Out of scope
- Prompt rewrites beyond what a model change strictly requires.

## Acceptance criteria
- [ ] No model name strings outside the registry (grep check)
- [ ] The model per task can be switched by env without a deploy of code changes
- [ ] Gauntlet comparison table recorded; chosen defaults are equal or better than baseline on accuracy
- [ ] Median submission → price stays under 60 s with the chosen defaults
