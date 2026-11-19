import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PRODUCT_NAME, SUPPORT_EMAIL, operatorStatement } from '@qolumns/shared'
import { subProcessorSentence } from '@/lib/legal/sub-processors'

export const metadata: Metadata = {
  title: `Privacy Policy — ${PRODUCT_NAME}`,
  description: `How ${PRODUCT_NAME} collects, uses and protects personal data.`,
}

const SECTIONS = [
  {
    title: '1. Who this covers',
    body: `This policy covers two groups: businesses with a ${PRODUCT_NAME} account, and their customers who submit enquiries through a widget, quote page or WhatsApp. The business you request a quote from is the controller of your enquiry; we process it on their behalf to produce and deliver the quote.`,
  },
  {
    title: '2. What we collect',
    body: 'For enquiries: contact details you provide (name, email, phone), job details, photos and documents you upload, and messages you send. For account holders: your login email, business configuration and billing details (payment cards are handled by Stripe and never touch our servers). When a business signs up we also keep how it found us: the site it came from, any campaign tags on the link it followed, and the first page of ours it opened. We also collect basic technical logs (IP address, timestamps) for security and rate limiting.',
  },
  {
    title: '3. How photos and AI are used',
    body: 'Photos and enquiry text are processed by AI models to read the job details and measurements used to prepare the estimate. Photos are used only to prepare the estimate. The measurements taken from them, never the photos, can improve the accuracy of that business’s own future estimates. We do not use your photos to train public AI models, and we do not sell your data. Where a business has connected its WhatsApp number, a message sent to that number is read by an AI model to see whether it asks for a price for one of that business’s services. A message that does not is not answered by us and its text is not kept; only that it arrived, from which number and when is recorded.',
  },
  {
    title: '4. Where data lives',
    // T-189: the providers are read from the one list the Terms' data-processing section prints
    body: `Data is handled for us by these providers, each only for the job named: ${subProcessorSentence()} Uploads are stored privately and served only via time-limited signed links or the controlled quote page. Each business sees only its own customers’ details and photos; no other business can.`,
  },
  {
    title: '5. How long we keep it',
    body: 'Enquiry and quote data is kept while the business account remains active, so quotes stay accessible to both sides. Businesses can request deletion of individual enquiries. Closed accounts are deleted after the 30-day export window.',
  },
  {
    title: '6. Your rights',
    body: 'You can request access to, correction of, or deletion of your personal data. If you submitted an enquiry, the quickest route is to contact the business you were dealing with; you can also contact us directly and we will pass the request on or act where we are able to.',
  },
  {
    title: '7. Cookies',
    body: 'On our own marketing pages (not the dashboard, and never on the quote pages and widgets our customers send to their customers) we may use the Meta Pixel and Meta Conversions API to measure our advertising; this sets Meta cookies, and the email you sign up with is sent to Meta only as a one-way hash. If your browser sends a Global Privacy Control signal, the Pixel is not loaded. To know how a new business found us, your browser tab remembers the site you came from, any campaign tags on the link and the first page you opened, until you close the tab. This is not a cookie, holds nothing that identifies you, and reaches us only if you sign up. The dashboard uses strictly necessary cookies for login sessions. Anti-bot verification on quote submission may set a cookie from Cloudflare Turnstile solely to distinguish humans from bots.',
  },
  {
    title: '8. Contact',
    // T-175: the address is written out (it is also where a deletion request goes; Meta's app settings link here)
    body: `Privacy questions or requests, including a request to delete your data: email ${SUPPORT_EMAIL}, or contact us through your dashboard. A business that has connected its WhatsApp number can remove our access at any time with Disconnect on its WhatsApp page.`,
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-text-muted">Last updated: 19 November 2026</p>
        {/* T-177: who runs the product. The company number comes from NEXT_PUBLIC_COMPANY_NUMBER. */}
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
