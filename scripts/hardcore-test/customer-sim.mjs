// Round-2 customer simulator: answers widget fields and clarification
// questions IN CHARACTER via Gemini, from only the persona + original
// request. No pre-scripted hints — if the persona wouldn't know a number,
// the form doesn't get one (unless the field is required, in which case they
// give a forced honest guess, like a real person facing a mandatory field).

import { readFileSync } from 'node:fs'

// T-135: the simulated customer's model is PINNED in the registry (harness.customer_sim)
// so model comparisons change the product's models, never the customer's.
const REGISTRY = JSON.parse(readFileSync(new URL('../../packages/shared/src/ai-models.json', import.meta.url), 'utf8'))
const SIM_MODEL = process.env.CUSTOMER_SIM_MODEL || REGISTRY.harness.customer_sim.model

async function callGeminiJson(apiKey, systemPrompt, userPrompt) {
  // up to 3 attempts — malformed/truncated JSON from the model killed S25 live
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${SIM_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
          }),
        }
      )
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json()
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
      console.log(`[customer-sim] attempt ${attempt} failed: ${String(err.message).slice(0, 120)}`)
    }
  }
  throw lastErr
}

const CUSTOMER_SYSTEM = `You are role-playing a REAL customer filling in a quote-request form on a small business website. You are not helpful AI — you are this specific person, with only their knowledge. Rules:
- Answer ONLY from what this person plausibly knows (their persona and their original message). Never invent precise measurements or counts they wouldn't know.
- Optional fields you can't answer: value null.
- REQUIRED fields you can't answer precisely: give the forced honest guess a real person would type (round numbers, "2ish" becomes 2), because the form won't submit without it.
- For fields with options, you MUST pick one of the provided option values verbatim (the "value" strings), or null if optional and none fit.
- Boolean fields: true/false per the persona's reality.
- Stay consistent with every number or fact already stated in the original message.
Return strict JSON only.`

export async function simulateFieldAnswers({ apiKey, persona, request, fields }) {
  if (!fields.length) return { answers: [], log: [] }
  const fieldSpec = fields.map((f) => ({
    fieldId: f.fieldId,
    label: f.label,
    type: f.type,
    required: !!(f.required || f.criticalForPricing),
    options: Array.isArray(f.options)
      ? f.options.map((o) => (typeof o === 'object' && o !== null ? o.value ?? o.label : o))
      : undefined,
  }))
  const result = await callGeminiJson(
    apiKey,
    CUSTOMER_SYSTEM,
    `PERSONA: ${persona}\n\nYOUR ORIGINAL MESSAGE TO THE BUSINESS:\n"""${request}"""\n\nTHE FORM NOW ASKS THESE QUESTIONS:\n${JSON.stringify(fieldSpec, null, 2)}\n\nReturn JSON: { "answers": [ { "fieldId": "...", "value": <string|number|boolean|null>, "why": "one short clause" } ] } — one entry per field, in order.`
  )
  const answers = []
  const log = []
  for (const f of fieldSpec) {
    const a = (result.answers || []).find((x) => x.fieldId === f.fieldId)
    let value = a?.value ?? null
    if (f.type === 'number' && value !== null) {
      const n = Number(value)
      value = Number.isFinite(n) ? n : null
    }
    if (value !== null && value !== undefined && value !== '') answers.push({ fieldId: f.fieldId, value })
    log.push({ fieldId: f.fieldId, label: f.label, type: f.type, required: f.required, value, how: a ? `sim: ${a.why || ''}` : 'sim: no answer' })
  }
  return { answers, log }
}

export async function simulateClarifyAnswers({ apiKey, persona, request, questions }) {
  const qSpec = questions.map((q) => ({ id: q.id || q.questionId, question: q.question || q.text, options: q.options }))
  const result = await callGeminiJson(
    apiKey,
    CUSTOMER_SYSTEM,
    `PERSONA: ${persona}\n\nYOUR ORIGINAL MESSAGE TO THE BUSINESS:\n"""${request}"""\n\nTHE BUSINESS REPLIED WITH FOLLOW-UP QUESTION(S):\n${JSON.stringify(qSpec, null, 2)}\n\nAnswer each as this person would — naturally, 1-2 sentences, honest about what you don't know. If options are given, answering with one of them is ideal. Return JSON: { "answers": [ { "id": "...", "answer": "..." } ] }.`
  )
  const answers = []
  const log = []
  for (const q of qSpec) {
    const a = (result.answers || []).find((x) => x.id === q.id)
    const answer = a?.answer || "I'm honestly not sure — please use your best judgement."
    answers.push({ questionId: q.id, answer })
    log.push({ question: q.question, answer, how: a ? 'sim' : 'sim-fallback' })
  }
  return { answers, log }
}
