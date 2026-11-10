import { FOUNDER, founderReady, type FounderContent } from '@/lib/marketing/founder'

/**
 * T-154: "Who is behind this". Renders nothing until lib/marketing/founder.ts
 * has a name and a note; the photo and support email show only when set.
 */
export function FounderNote({ content = FOUNDER }: { content?: FounderContent }) {
  if (!founderReady(content)) return null
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6" data-testid="founder">
      <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Who is behind this</h2>
      <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
        {content.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local photo in public/
          <img src={content.photo} alt={content.name} className="h-24 w-24 shrink-0 rounded-full object-cover" />
        ) : null}
        <div>
          <p className="text-text-secondary">{content.note}</p>
          <p className="mt-3 font-semibold text-text-primary">
            {content.name}
            {content.role ? <span className="font-normal text-text-muted"> · {content.role}</span> : null}
          </p>
          {content.supportEmail ? (
            <p className="mt-1 text-sm">
              <a href={`mailto:${content.supportEmail}`} className="font-semibold text-primary underline underline-offset-2">
                {content.supportEmail}
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
