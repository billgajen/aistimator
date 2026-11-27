'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { buildShareTexts } from '@/lib/share-texts'
import { quoteLinkUrl } from '@/lib/quote-link-url'
import { QuoteLinkCard } from './QuoteLinkCard'
import { OwnAddressCard } from './OwnAddressCard'
import type { AddressView } from '@/lib/own-address'
import { QrCode } from './QrCode'
import { WhereToPutIt } from './WhereToPutIt'
import { UseItOnWhatsApp } from './UseItOnWhatsApp'
import { EmbedCodeCard } from './EmbedCodeCard'
import { FormFieldsBuilder } from './FormFieldsBuilder'
import { GuideLink } from '@/components/guide/GuideLink'

/** T-149: the Quote link page (was "Share" until T-160), in the order a small trade needs it. */
export function SharePageClient(props: {
  appOrigin: string
  tenantKey: string
  businessName: string
  region?: string | null
  initialSlug: string
  changeable: boolean
  /** T-174: the link still ends in random characters, so cleaner ones are offered */
  random?: boolean
  /** T-199: the business's own address: what it has, whether it can choose one, the links to show */
  address?: AddressView | null
}) {
  const [slug, setSlug] = useState(props.initialSlug)
  const [changeable, setChangeable] = useState(props.changeable)
  // T-174: the offer stays up after a replacement (it then says what happened); the one-time change returns on the next visit
  const [random] = useState(Boolean(props.random))
  const [address, setAddress] = useState<AddressView | null>(props.address ?? null)
  const quoteLink = quoteLinkUrl(props.appOrigin, slug)
  // T-199: the address is the main link (the QR code, every copy button, the wording to paste) when the
  // business has one and can use it; its quote link is shown under it and keeps working
  const ownAddress = address?.links.addressHostname ? { url: address.links.main, tag: address.tag } : null
  const link = ownAddress?.url ?? quoteLink

  return (
    <div className="space-y-6">
      {/* T-207: the guide for this page, under its title */}
      <PageHeader title="Quote link" description="Give customers this link, or put the form on your website." below={<GuideLink id="quote-link" />} />

      {address?.canChoose && <OwnAddressCard view={address} place="quote-link" onChosen={setAddress} />}

      <QuoteLinkCard
        address={ownAddress}
        planLine={address?.planLine ?? null}
        appOrigin={props.appOrigin}
        slug={slug}
        changeable={changeable}
        random={random}
        onChanged={(next) => {
          setSlug(next)
          setChangeable(false)
        }}
        onReplaced={setSlug}
      />

      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <h2 className="mb-4 text-lg font-medium text-text-primary">QR code</h2>
        <QrCode value={link} fileName={`${slug}-quote-qr.png`} />
      </section>

      <WhereToPutIt texts={buildShareTexts({ businessName: props.businessName, link, region: props.region })} />

      {/* T-152: WhatsApp lives here now (the full in-chat setup stays at /app/whatsapp) */}
      <UseItOnWhatsApp businessName={props.businessName} link={link} region={props.region} />

      <EmbedCodeCard
        appOrigin={props.appOrigin}
        tenantKey={props.tenantKey}
        businessName={props.businessName}
        link={link}
        region={props.region}
      />

      <details className="group rounded-xl bg-surface p-6 shadow-warm">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-lg font-medium text-text-primary">
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
