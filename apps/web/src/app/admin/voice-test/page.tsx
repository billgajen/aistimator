import { notFound } from 'next/navigation'
import { DEFAULT_LIVE_VOICE, LIVE_VOICES, comparisonVoices, resolveComparisonModel, resolveModelRoute } from '@qolumns/shared'
import { contactRequirementOf } from '@/lib/contact-rules'
import { createAdminClient } from '@/lib/supabase/server'
import { voiceTestAdmin } from '@/lib/voice/access'
import { DEFAULT_TEST_BUSINESS_ID, type Engine } from '@/lib/voice/config'
import { openAiEnabled } from '@/lib/voice/openai-live'
import { VoiceTest, type EngineChoice } from '@/components/voice-test/VoiceTest'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Voice test', robots: { index: false, follow: false } }

/**
 * /admin/voice-test (T-210, T-211): the private "Oumn test call".
 *
 * A test of a planned voice assistant: what a call costs, how long she takes to answer, how she
 * sounds, whether the prices she says are the pricing engine's, and whether she keeps to the
 * business's own information. It is here only while VOICE_TEST_ENABLED=true and only for a
 * platform admin; otherwise this address does not exist. A call stores no quote, lead or booking.
 */
export default async function VoiceTestPage() {
  const admin = await voiceTestAdmin()
  if (!admin) notFound()

  // Read only: the names of the businesses, for the picker. The newest thousand and the default one, by name.
  const db = createAdminClient()
  const [{ data: newest }, { data: usual }] = await Promise.all([
    db.from('tenants').select('id, name, contact_requirement').order('created_at', { ascending: false }).limit(1000),
    db.from('tenants').select('id, name, contact_requirement').eq('id', DEFAULT_TEST_BUSINESS_ID).maybeSingle(),
  ])
  const found = new Map<string, { id: string; name: string; contact: ReturnType<typeof contactRequirementOf> }>()
  for (const t of [...(usual ? [usual] : []), ...(newest ?? [])] as Array<{ id: string; name: string; contact_requirement?: string | null }>) found.set(t.id, { id: t.id, name: t.name, contact: contactRequirementOf(t.contact_requirement) })
  const businesses = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))

  // The second engine is offered only when its key is set (AD-102)
  const engines: EngineChoice[] = [{ id: 'gemini' as Engine, model: resolveModelRoute('voice_call', process.env).model, voices: [...LIVE_VOICES], defaultVoice: DEFAULT_LIVE_VOICE }]
  if (openAiEnabled()) {
    const model = resolveComparisonModel('voice_call_openai', process.env).model
    const voices = comparisonVoices(model)
    if (voices) engines.push({ id: 'openai', model, voices: [...voices.voices], defaultVoice: voices.default })
  }

  return <VoiceTest businesses={businesses} defaultBusinessId={found.has(DEFAULT_TEST_BUSINESS_ID) ? DEFAULT_TEST_BUSINESS_ID : (businesses[0]?.id ?? '')} engines={engines} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null} />
}
