import { notFound } from 'next/navigation'
import { DEFAULT_LIVE_VOICE, LIVE_VOICES, getLivePrice, resolveModelRoute } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { voiceTestAdmin } from '@/lib/voice/access'
import { DEFAULT_TEST_BUSINESS_ID } from '@/lib/voice/config'
import { VoiceTest } from '@/components/voice-test/VoiceTest'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Voice test', robots: { index: false, follow: false } }

/**
 * /admin/voice-test (T-210): the private "Oumn test call".
 *
 * A one-day test of a planned voice assistant: what a call costs, how long she takes to answer,
 * how she sounds, whether the prices she says are the pricing engine's, and whether she keeps to
 * the business's own information. It is here only while VOICE_TEST_ENABLED=true and only for a
 * platform admin; otherwise this address does not exist. A call stores nothing.
 */
export default async function VoiceTestPage() {
  const admin = await voiceTestAdmin()
  if (!admin) notFound()

  // Read only: the names of the businesses, for the picker. The newest thousand and the default one, by name.
  const db = createAdminClient()
  const [{ data: newest }, { data: usual }] = await Promise.all([
    db.from('tenants').select('id, name').order('created_at', { ascending: false }).limit(1000),
    db.from('tenants').select('id, name').eq('id', DEFAULT_TEST_BUSINESS_ID).maybeSingle(),
  ])
  const found = new Map<string, string>()
  for (const t of [...(usual ? [usual] : []), ...(newest ?? [])] as Array<{ id: string; name: string }>) found.set(t.id, t.name)
  const businesses = [...found].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  const model = resolveModelRoute('voice_call', process.env).model

  return (
    <VoiceTest
      businesses={businesses}
      defaultBusinessId={businesses.some((b) => b.id === DEFAULT_TEST_BUSINESS_ID) ? DEFAULT_TEST_BUSINESS_ID : (businesses[0]?.id ?? '')}
      voices={[...LIVE_VOICES]}
      defaultVoice={DEFAULT_LIVE_VOICE}
      model={model}
      price={getLivePrice(model)}
    />
  )
}
