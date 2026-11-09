/**
 * Each quote's customer-link token, kept on the device that created it.
 *
 * The server stores only a hash of the token, so the raw value exists only in
 * the create response. The app keeps it to (a) share the quote link and
 * (b) pass it back when the business answers a confirmation, so the worker
 * can email the customer their link (it needs the raw token for that).
 */

import * as SecureStore from 'expo-secure-store'

const key = (quoteId: string) => `quote_token_${quoteId.replace(/[^A-Za-z0-9_.-]/g, '')}`

export async function saveQuoteToken(quoteId: string, viewUrl: string): Promise<void> {
  const token = new URL(viewUrl).searchParams.get('token')
  if (token) await SecureStore.setItemAsync(key(quoteId), JSON.stringify({ token, viewUrl }))
}

export async function loadQuoteToken(quoteId: string): Promise<{ token: string; viewUrl: string } | null> {
  const raw = await SecureStore.getItemAsync(key(quoteId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as { token: string; viewUrl: string }
  } catch {
    return null
  }
}
