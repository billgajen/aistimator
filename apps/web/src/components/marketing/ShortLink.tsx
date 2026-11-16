import { Fragment } from 'react'

/** A link as people say it: no "https://", no "www.", no closing slash */
export function shortLink(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

/**
 * T-170: a link shown short, that never breaks inside a word. It may wrap
 * only after a slash: each part between slashes is kept whole.
 */
export function ShortLink({ url, className = '' }: { url: string; className?: string }) {
  const parts = shortLink(url).split('/')
  return (
    <span className={className} data-testid="short-link">
      {parts.map((part, i) => (
        <Fragment key={i}>
          <span className="whitespace-nowrap">
            {part}
            {i < parts.length - 1 ? '/' : ''}
          </span>
          {i < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </span>
  )
}
