/**
 * SMS adapter for the shared intake engine (T-136). Same state machine as
 * WhatsApp; SMS-specific bits are plain-text emphasis, MMS download from
 * Twilio, opt-out-checked sending with segment logging.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelAdapter } from './messaging/types'
import { sendSmsChecked, downloadTwilioMedia } from './sms'

export interface SmsTenantConfig {
  tenantId: string
  phoneNumber: string
  messagingServiceSid?: string | null
}

export function smsChannel(
  supabase: SupabaseClient,
  config: SmsTenantConfig,
  conversationId: string | null
): ChannelAdapter {
  return {
    name: 'sms',
    conversationTable: 'sms_conversations',
    senderNumberNoun: 'mobile number',
    emphasize: (text) => text, // SMS has no formatting; asterisks would show literally
    downloadMedia: async (message) =>
      message.mediaId ? downloadTwilioMedia(message.mediaId) : { success: false, error: 'no media url' },
    send: (to, text) =>
      sendSmsChecked(supabase, {
        tenantId: config.tenantId,
        conversationId,
        to,
        from: config.phoneNumber,
        body: text,
        messagingServiceSid: config.messagingServiceSid,
      }),
  }
}
