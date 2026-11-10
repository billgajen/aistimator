'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { buildShareTexts } from '@/lib/share-texts'
import { quoteLinkUrl } from '@/lib/quote-link-url'
import { QuoteLinkCard } from './QuoteLinkCard'
import { QrCode } from './QrCode'
import { WhereToPutIt } from './WhereToPutIt'
import { EmbedCodeCard } from './EmbedCodeCard'
import { FormFieldsBuilder } from './FormFieldsBuilder'

/** T-149: the Share page, in the order a small trade needs it. */
export function SharePageClient(props: {
  appOrigin: string
  tenantKey: string
  businessName: string
  region?: string | null
  initialSlug: string
  changeable: boolean
}) {
  const [slug, setSlug] = useState(props.initialSlug)
  const [changeable, setChangeable] = useState(props.changeable)
  const link = quoteLinkUrl(props.appOrigin, slug)

  return (
    <div className="space-y-6">
      <PageHeader title="Share" description="Send customers to your own quote page. No website needed." />

      <QuoteLinkCard
        appOrigin={props.appOrigin}
        slug={slug}
        changeable={changeable}
        onChanged={(next) => {
          setSlug(next)
          setChangeable(false)
        }}
      />

      <section className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <h2 className="mb-4 text-lg font-medium text-text-primary">QR code</h2>
        <QrCode value={link} fileName={`${slug}-quote-qr.png`} />
      </section>

      <WhereToPutIt texts={buildShareTexts({ businessName: props.businessName, link, region: props.region })} />

      <EmbedCodeCard
        appOrigin={props.appOrigin}
        tenantKey={props.tenantKey}
        businessName={props.businessName}
        link={link}
        region={props.region}
      />

      <details className="group rounded-warm-lg bg-surface p-6 shadow-warm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-medium text-text-primary">
          <svg className="h-4 w-4 text-text-muted transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advanced <span className="text-sm font-normal text-text-muted">· extra questions on the form</span>
        </summary>
        <div className="mt-4">
          <FormFieldsBuilder />
        </div>
      </details>
    </div>
  )
}
