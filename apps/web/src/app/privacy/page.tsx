import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy — Aistimator',
  description: 'How Aistimator collects, uses and protects personal data.',
}

const SECTIONS = [
  {
    title: '1. Who this covers',
    body: 'This policy covers two groups: businesses with an Aistimator account, and their customers who submit enquiries through a widget, quote page or WhatsApp. The business you request a quote from is the controller of your enquiry; we process it on their behalf to produce and deliver the quote.',
  },
  {
    title: '2. What we collect',
    body: 'For enquiries: contact details you provide (name, email, phone), job details, photos and documents you upload, and messages you send. For account holders: your login email, business configuration and billing details (payment cards are handled by Stripe and never touch our servers). We also collect basic technical logs (IP address, timestamps) for security and rate limiting.',
  },
  {
    title: '3. How photos and AI are used',
    body: 'Photos and enquiry text are processed by AI models to extract measurements and job details used to build the quote. They are used to produce your quote and to improve the accuracy of the business’s own future estimates. We do not use your photos to train public AI models, and we do not sell your data.',
  },
  {
    title: '4. Where data lives',
    body: 'Data is stored with our infrastructure providers: Supabase (database, EU region), Cloudflare (file storage and processing), Vercel (hosting), Stripe (payments), Postmark (email) and Google (AI processing). Uploads are stored privately and served only via time-limited signed links or the controlled quote page.',
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
    body: 'On our own marketing pages (not the dashboard, and never on the quote pages and widgets our customers send to their customers) we may use the Meta Pixel and Meta Conversions API to measure our advertising; this sets Meta cookies, and the email you sign up with is sent to Meta only as a one-way hash. If your browser sends a Global Privacy Control signal, the Pixel is not loaded. The dashboard uses strictly necessary cookies for login sessions. Anti-bot verification on quote submission may set a cookie from Cloudflare Turnstile solely to distinguish humans from bots.',
  },
  {
    title: '8. Contact',
    body: 'Privacy questions or requests: contact us through your dashboard or the email address on our website.',
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
        <p className="mt-3 text-sm text-text-muted">Last updated: 24 July 2026</p>
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
