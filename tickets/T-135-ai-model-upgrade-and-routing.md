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
- [x] No model name strings outside the registry (grep check)
- [x] The model per task can be switched by env without a deploy of code changes
- [x] Gauntlet comparison table recorded; chosen defaults are equal or better than baseline on accuracy
- [ ] Median submission → price stays under 60 s with the chosen defaults — NOT met: 66 s (baseline 47 s); follow-up: per-task thinking level
  - 2026-11-08: per-task thinking level shipped (text tasks `low`; S08 146 s → 78 s). Photo-measured quotes still 75–150 s, so sync + 60 s can't hold them → queues (T-132) or a higher maxDuration; see DEPLOY.md §0

## Plan
1. **Registry** `packages/shared/src/ai-models.json` (data) + `ai-models.ts` (typed access):
   task → `{ provider, model }` defaults, a per-model token price table with source + date,
   and pinned harness models. `resolveModelRoute(task, env)` honours `AI_MODEL_<TASK>`
   (`model` or `provider:model`) plus the legacy `ADJUDICATION_MODEL`. `estimateCostUsd()`.
   Tasks: extraction_pass, adjudication, compile, wording, chat_widget, service_match, identification.
2. **Worker provider interface** `ai/client.ts`: `AiClient` (text, vision, schema, vision+schema)
   with a usage meter. `GeminiClient` implements it and reports `usageMetadata`. New
   `AnthropicClient` (official `@anthropic-ai/sdk`, structured outputs) behind the same interface,
   selectable by config for adjudication and identification. `createAiClient(task, env, meter)`.
   Every consumer types against `AiClient`, not `GeminiClient`.
3. **Processor**: vision work (signals, measurement, inventory) uses the `extraction_pass` client,
   text work (wording, gate, validator, addons, cross-service, recommendations) uses `wording`,
   adjudication uses `adjudication`. Per-quote `aiUsage` (calls, tokens, estimated USD by task)
   stored in the pricing trace.
4. **Web**: chat route, AI-draft shared caller, service matcher read the registry. Harness
   `customer-sim.mjs` reads its pinned model from the registry JSON (simulated customer must not
   change between model comparisons).
5. **Docs**: CLAUDE.md, 00-v1-scope.md, README point at the registry.
6. **Evaluate**: gauntlet round 1 per candidate (current 2.5 Flash + pro-latest vs 3.8 Flash,
   and adjudication candidates), record accuracy / cost / latency in the CHANGELOG, pick defaults.
   Note: Google reroutes `gemini-2.5-flash` to `gemini-3.5-flash-lite` on 2026-12-01.

## Implementation Summary
- Registry `packages/shared/src/ai-models.json`: task routes, per-model capabilities, sourced prices,
  pinned harness model; `AI_MODEL_<TASK>` env overrides.
- Worker `AiClient` interface + factory; Gemini client honours capabilities; new Claude adapter
  (official SDK, structured outputs, refusal fallback) behind the same interface.
- Per-quote AI cost (`pricing_trace_json.aiUsage`).
- Root-caused Gemini 3 measurement failures (schema-constrained numbers degenerate) and fixed them
  with prompt-mode structured output as registry data; legacy models unchanged.
- New defaults: `gemini-3.8-flash` (Flash tasks), `gemini-3.1-pro-preview` (adjudication); comparison in CHANGELOG.
- Open: latency 66 s median vs 60 s target; Claude adapter untested live (no key).
