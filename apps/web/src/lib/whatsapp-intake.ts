/**
 * WhatsApp guided intake (T-111) — now a thin adapter over the shared,
 * channel-agnostic intake engine (T-136). Behaviour is pinned by
 * `__tests__/whatsapp-intake.test.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppConversation } from '@estimator/shared'
import { sendTextMessage, downloadMedia, type WhatsAppConfig, type IncomingMessage } from './whatsapp'
import { runIntake, shouldStartIntake, type IntakeResult } from './messaging/intake-engine'
import type { ChannelAdapter } from './messaging/types'

export { shouldStartIntake }

/** WhatsApp Cloud API adapter for the intake engine */
export function whatsappChannel(config: WhatsAppConfig): ChannelAdapter {
  return {
    name: 'whatsapp',
    conversationTable: 'whatsapp_conversations',
    senderNumberNoun: 'WhatsApp number',
    emphasize: (text) => `*${text}*`,
    downloadMedia: async (message) =>
      message.mediaId ? downloadMedia(config.accessToken, message.mediaId) : { success: false, error: 'no media id' },
    send: (to, text) => sendTextMessage(config, { to, text }),
  }
}

export async function processIntakeMessage(ctx: {
  supabase: SupabaseClient
  waConfig: WhatsAppConfig
  tenantId: string
  conversation: WhatsAppConversation
  message: IncomingMessage
}): Promise<IntakeResult> {
  return runIntake({
    supabase: ctx.supabase,
    channel: whatsappChannel(ctx.waConfig),
    tenantId: ctx.tenantId,
    conversation: ctx.conversation,
    message: ctx.message,
  })
}

/**
 * Send response message via WhatsApp
 */
export async function sendIntakeResponse(
  config: WhatsAppConfig,
  to: string,
  text: string
): Promise<boolean> {
  const result = await sendTextMessage(config, { to, text })
  return result.success
}
