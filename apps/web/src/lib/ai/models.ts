/**
 * Web-side model routing (T-135). Web AI paths call Gemini over REST, so a
 * task routed to another provider by env falls back to the registry default
 * (with a warning) instead of failing the request.
 */

import { resolveModelRoute, resolveThinkingLevel, type AiTask } from '@estimator/shared'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export function geminiModelFor(task: AiTask): string {
  const route = resolveModelRoute(task, process.env)
  if (route.provider === 'gemini') return route.model
  const fallback = resolveModelRoute(task, {})
  console.warn(
    `[AI] ${task} is routed to ${route.provider}:${route.model}, which the web app does not call yet — using ${fallback.model}`
  )
  return fallback.model
}

/** generateContent URL (without the key) for a task's model */
export function geminiUrlFor(task: AiTask): string {
  return `${GEMINI_API_BASE}/${geminiModelFor(task)}:generateContent`
}

/** generationConfig fragment for the task's registry thinking level ({} when none applies) */
export function geminiThinkingConfig(task: AiTask): { thinkingConfig?: { thinkingLevel: string } } {
  const level = resolveThinkingLevel(task, geminiModelFor(task), process.env)
  return level ? { thinkingConfig: { thinkingLevel: level } } : {}
}
