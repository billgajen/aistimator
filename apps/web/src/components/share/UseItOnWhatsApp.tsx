'use client'

import Link from 'next/link'
import { buildWhatsAppTexts, whatsAppSendMessage, whatsAppShareUrl } from '@/lib/share-texts'
import { useCopy } from './useCopy'

/**
 * T-152: "Use it on WhatsApp" — the quote link in WhatsApp with no setup:
 * a one-tap send, ready texts for the WhatsApp Business app, and the way into
 * full in-chat quoting (the existing /app/whatsapp page, unchanged).
 */
export function UseItOnWhatsApp(props: { businessName: string; link: string; region?: string | null }) {
  const { copy, copiedId } = useCopy()
  const texts = buildWhatsAppTexts(props)
  const sendUrl = whatsAppShareUrl(whatsAppSendMessage(props))

  return (
    <section className="rounded-warm-lg bg-surface p-6 shadow-warm" data-testid="use-it-on-whatsapp">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Use it on WhatsApp</h2>
          <p className="mt-1 text-sm text-text-muted">Send your quote link in any WhatsApp chat, or let WhatsApp Business send it for you.</p>
        </div>
        <a
          href={sendUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="send-on-whatsapp"
          onClick={() => {
            // sharing the link counts for the Home checklist, like Copy
            fetch('/api/tenant/share-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'copied' }),
            }).catch(() => undefined)
          }}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Send on WhatsApp
        </a>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-text-primary">For the WhatsApp Business app</h3>
      <ul className="mt-3 space-y-3">
        {texts.map((t) => (
          <li key={t.id} className="rounded-warm-lg border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-text-primary">{t.label}</h4>
                <p className="mt-0.5 text-xs text-text-muted">{t.steps[0]}</p>
                <p className="text-xs text-text-muted">{t.steps[1]}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(`wa_${t.id}`, t.text)}
                className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-background"
              >
                {copiedId === `wa_${t.id}` ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 whitespace-pre-line break-words text-sm text-text-secondary" data-testid={`whatsapp-text-${t.id}`}>
              {t.text}
            </p>
          </li>
        ))}
      </ul>

      <Link href="/app/whatsapp" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
        Connect your WhatsApp number for full in-chat quoting (advanced)
      </Link>
    </section>
  )
}
