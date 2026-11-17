/**
 * T-176: tell a customer on WhatsApp that their estimate is ready — server only.
 *
 * Only for an estimate that was asked for on WhatsApp (its conversation names
 * the quote). When the business approves it:
 *   - the customer wrote in the last 24 hours: an ordinary message, which
 *     Meta delivers free inside its service allowance;
 *   - longer ago: the business's approved "estimate ready" template, the only
 *     thing Meta delivers then. With no approved template nothing is sent
 *     (the customer still has the email, and the link from the chat).
 *
 * This never stops or delays an approval for long: it is tried once, with a
 * time limit, and every failure ends in "not sent". Nothing about the
 * customer is logged: no number, no link (the link carries the quote's token).
 */
import { getRegion } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp'
import { decryptSecret } from '@/lib/whatsapp-crypto'
import { approvedEstimateTemplate } from '@/lib/whatsapp-template-service'
import { estimateReadyText, estimateTemplateParameters, templateLanguage } from '@/lib/whatsapp-templates'
import { lastInboundAt, windowOpen } from '@/lib/whatsapp-window'

type Admin = ReturnType<typeof createAdminClient>

/** How the customer was told, or why not */
export type EstimateNotice =
  | { sent: 'message' | 'template' }
  | { sent: null; why: 'not_whatsapp' | 'not_connected' | 'no_template' | 'refused' | 'timed_out' | 'error' }

/** The approval waits this long for WhatsApp, and no longer */
export const NOTICE_TIME_LIMIT_MS = 8_000

export interface EstimateNoticeInput {
  tenantId: string
  quoteId: string
  businessName: string
  region?: string | null
  quoteViewUrl: string
  now?: Date
}

/**
 * Never throws and never takes longer than the time limit. The service-role
 * client is made in here (the stored connection is server-only), inside the
 * guard, so not even a missing setting can reach the approval.
 */
export async function notifyEstimateReady(opts: EstimateNoticeInput, admin?: Admin): Promise<EstimateNotice> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<EstimateNotice>((resolve) => {
    timer = setTimeout(() => resolve({ sent: null, why: 'timed_out' }), NOTICE_TIME_LIMIT_MS)
  })
  try {
    return await Promise.race([send(admin ?? createAdminClient(), opts), limit])
  } catch (error) {
    console.error('[WhatsApp notice] failed:', error instanceof Error ? error.name : 'unknown error')
    return { sent: null, why: 'error' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function send(admin: Admin, opts: EstimateNoticeInput): Promise<EstimateNotice> {
  const { tenantId, quoteId } = opts
  // Was this estimate asked for on WhatsApp? Its conversation names the quote.
  const { data: conversations } = await admin
    .from('whatsapp_conversations')
    .select('id, customer_phone')
    .eq('tenant_id', tenantId)
    .eq('intake_data->>_quoteId', quoteId)
    .limit(1)
  const conversation = conversations?.[0] as { id: string; customer_phone: string } | undefined
  if (!conversation?.customer_phone) return { sent: null, why: 'not_whatsapp' }

  const { data: row } = await admin
    .from('whatsapp_configs')
    .select('phone_number_id, display_phone_number, access_token_encrypted, waba_id, connection_method, is_active')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const config = row as {
    phone_number_id: string
    display_phone_number: string
    access_token_encrypted: string
    waba_id: string | null
    connection_method: string
    is_active: boolean
  } | null
  if (!config || !config.is_active) return { sent: null, why: 'not_connected' }

  const to = conversation.customer_phone
  const token = decryptSecret(config.access_token_encrypted)
  const sender = { phoneNumberId: config.phone_number_id, accessToken: token }
  const text = estimateReadyText(opts.businessName, opts.quoteViewUrl)
  const open = windowOpen(await lastInboundAt(admin, tenantId, to), opts.now ?? new Date())

  let how: 'message' | 'template'
  let messageId: string | undefined
  if (open) {
    const result = await sendTextMessage(sender, { to, text })
    if (!result.success) return { sent: null, why: 'refused' }
    how = 'message'
    messageId = result.messageId
  } else {
    // templates belong to the WhatsApp account: only a connection made through Meta knows its account
    if (config.connection_method !== 'embedded' || !config.waba_id) return { sent: null, why: 'no_template' }
    const template = await approvedEstimateTemplate(token, config.waba_id, templateLanguage(getRegion(opts.region).locale))
    if (!template) return { sent: null, why: 'no_template' }
    const result = await sendTemplateMessage(sender, {
      to,
      templateName: template.name,
      languageCode: template.language,
      components: estimateTemplateParameters(opts.quoteViewUrl),
    })
    if (!result.success) return { sent: null, why: 'refused' }
    how = 'template'
    messageId = result.messageId
  }

  // kept with its conversation, like every other message. The link is not stored: it carries the quote's token.
  await admin.from('whatsapp_messages').insert({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    wa_message_id: messageId ?? null,
    direction: 'outbound',
    message_type: how === 'template' ? 'template' : 'text',
    from_phone: config.display_phone_number,
    to_phone: to,
    content: estimateReadyText(opts.businessName, '(the link to the estimate)'),
    status: 'sent',
  })
  return { sent: how }
}
