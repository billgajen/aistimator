/**
 * Messaging channel abstraction (T-136, AD-027).
 *
 * The intake state machine (`intake-engine.ts`) is channel-agnostic; each
 * channel supplies a thin adapter for sending, media download, formatting
 * and where its conversations are stored. WhatsApp and SMS share one engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegionDefinition, WhatsAppConversation } from '@estimator/shared'

export type ChannelName = 'whatsapp' | 'sms'

/** A customer message, normalised across channels */
export interface InboundMessage {
  messageId: string
  from: string
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'location' | 'contacts'
  text?: string
  /** Channel media reference (WhatsApp media id, or an MMS media URL) */
  mediaId?: string
  mimeType?: string
  caption?: string
  timestamp?: string
}

export interface MediaDownload {
  success: boolean
  data?: Buffer
  contentType?: string
  error?: string
}

export interface SendResult {
  success: boolean
  messageId?: string
  /** SMS only: billable segments for this message */
  segments?: number
  error?: string
}

export interface ChannelAdapter {
  name: ChannelName
  /** Table holding this channel's intake conversations */
  conversationTable: 'whatsapp_conversations' | 'sms_conversations'
  /** How replies refer to the customer's own number ("WhatsApp number" / "mobile number") */
  senderNumberNoun: string
  /** Emphasis for a short phrase (WhatsApp *bold*; SMS has no formatting) */
  emphasize(text: string): string
  downloadMedia(message: InboundMessage): Promise<MediaDownload>
  send(to: string, text: string): Promise<SendResult>
}

/** Conversations share one row shape across channels */
export type IntakeConversation = WhatsAppConversation

export interface IntakeContext {
  supabase: SupabaseClient
  channel: ChannelAdapter
  tenantId: string
  conversation: IntakeConversation
  message: InboundMessage
  /** Tenant region (loaded once per message) — postal wording + formats */
  region?: RegionDefinition
}
