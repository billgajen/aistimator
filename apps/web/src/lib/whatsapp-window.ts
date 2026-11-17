/**
 * T-176: WhatsApp's customer service window.
 *
 * A business may send an ordinary (free-form) message only for 24 hours after
 * the customer's last message to it. Outside that window Meta still ACCEPTS
 * the call (HTTP 200 and a message id) and then does not deliver it: the
 * refusal (code 131047) arrives later, on the status webhook. So the only way
 * to know beforehand is our own record of the customer's last message.
 * Outside the window, only an approved message template is delivered.
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Sending right at the edge would lose the race with Meta's own clock */
const EDGE_MS = 5 * 60 * 1000

/** Is the window open, going by the customer's last message to the business? */
export function windowOpen(lastInboundAt: string | null, now: Date): boolean {
  if (!lastInboundAt) return false
  const at = new Date(lastInboundAt).getTime()
  if (Number.isNaN(at)) return false
  const age = now.getTime() - at
  return age >= 0 && age < SERVICE_WINDOW_MS - EDGE_MS
}

/** When this phone last messaged this business (digits only, as Meta sends them); null when it never has */
export async function lastInboundAt(admin: Admin, tenantId: string, phone: string): Promise<string | null> {
  const { data } = await admin
    .from('whatsapp_messages')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .eq('from_phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
  return ((data?.[0] as { created_at?: string } | undefined)?.created_at as string | undefined) ?? null
}
