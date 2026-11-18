import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PRODUCT_NAME, SUPPORT_EMAIL, operatorStatement } from '@qolumns/shared'

/**
 * T-181: how to have your data deleted, on a page of its own.
 *
 * Meta asks every app for a "data deletion instructions URL" before it can go
 * Live (App settings, Basic, "User data deletion"). Until now that field
 * pointed at the Privacy Policy, whose last section says where to write. This
 * page says the same things, in steps, for the three kinds of people who might
 * ask. It makes no promise the Privacy Policy and the Terms do not already
 * make: if one of them changes, change this page with it.
 */
export const metadata: Metadata = {
  title: `Delete your data — ${PRODUCT_NAME}`,
  description: `How to have your data deleted from ${PRODUCT_NAME}, and how a business removes our access to its WhatsApp account.`,
}

const SECTIONS = [
  {
    title: '1. If you asked a business for a quote',
    body: `Your request, your photos and your contact details were sent to the business you asked, and ${PRODUCT_NAME} holds them for that business. The quickest way to have them deleted is to ask that business. You can also email ${SUPPORT_EMAIL} from the address you used for the request, and say which business it was. We pass the request on to the business, or act on it ourselves where we are able to.`,
  },
  {
    title: `2. If your business uses ${PRODUCT_NAME}`,
    body: `Email ${SUPPORT_EMAIL} from your account’s email address. Tell us whether you want a single customer’s request deleted or your whole account closed. When an account is closed, your quote history stays available for export for 30 days and is then deleted.`,
  },
  {
    title: '3. If you connected a WhatsApp number',
    body: `You can remove our access yourself at any time: open the WhatsApp page in your dashboard and press Disconnect. We ask Meta to stop sending us that account’s messages and we delete the access token we hold for it. Removing the ${PRODUCT_NAME} app from your Meta Business settings does the same. To have the WhatsApp messages and photos we already hold for your business deleted, email ${SUPPORT_EMAIL} as in section 2.`,
  },
  {
    title: '4. What a deletion covers',
    body: 'The personal data held for the request or the account you name: contact details, the request and its answers, photos and documents, and messages.',
  },
  {
    title: '5. Questions',
    body: `The Privacy Policy says what we collect and why. For anything about your data, email ${SUPPORT_EMAIL}.`,
  },
]

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary">
          Delete your data
        </h1>
        <p className="mt-3 text-sm text-text-muted">Last updated: 18 November 2026</p>
        <p className="mt-3 leading-relaxed text-text-secondary" data-testid="operator">
          {operatorStatement(process.env.NEXT_PUBLIC_COMPANY_NUMBER)}
        </p>
        <div className="tape-rule mt-8" />
        <div className="mt-10 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-lg font-bold text-text-primary">{section.title}</h2>
              <p className="mt-2 leading-relaxed text-text-secondary">{section.body}</p>
            </section>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
