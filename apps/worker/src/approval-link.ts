/**
 * T-156: issue the one-tap approval link for the "Review and approve" email.
 *
 * Any older open link for the quote is marked replaced first, so only the
 * newest email's button works. Only the hash is stored; the token itself goes
 * into the email and nowhere else. A failure here never blocks the email: it
 * goes out with the dashboard link only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateApprovalToken, approvalLinkExpiry, approvalLinkUrl } from '@estimator/shared'

export async function issueApprovalLink(
  supabase: SupabaseClient,
  opts: { quoteId: string; tenantId: string; appUrl: string; now?: Date }
): Promise<string | undefined> {
  const now = opts.now ?? new Date()
  try {
    const { error: replaceError } = await supabase
      .from('quote_approval_tokens')
      .update({ invalidated_at: now.toISOString(), invalidated_reason: 'replaced' })
      .eq('quote_id', opts.quoteId)
      .is('used_at', null)
      .is('invalidated_at', null)
    if (replaceError) throw new Error(replaceError.message)

    const { token, hash } = await generateApprovalToken()
    const { error } = await supabase.from('quote_approval_tokens').insert({
      tenant_id: opts.tenantId,
      quote_id: opts.quoteId,
      token_hash: hash,
      expires_at: approvalLinkExpiry(now).toISOString(),
    })
    if (error) throw new Error(error.message)
    return approvalLinkUrl(opts.appUrl, token)
  } catch (e) {
    console.error(`[ApprovalLink] Could not issue a link for ${opts.quoteId}; the email goes with the dashboard link only:`, e instanceof Error ? e.message : e)
    return undefined
  }
}
