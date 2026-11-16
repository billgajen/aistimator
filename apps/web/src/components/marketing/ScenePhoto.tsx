import type { ScenePhoto as Photo } from '@/lib/marketing/photos'

/**
 * T-170: a scene photograph behind a band's words (system.md, Imagery): the
 * hero of a trade page, Home's closing band. Home's own hero is HeroPhoto,
 * which draws the same thing for its one picture.
 *
 * The photograph is the band's background and fades into the band's own
 * ground where the words are; under 768 px it fills the top of the band and
 * fades downwards, and the words start over the faded part. The styles are in
 * globals.css ("scene photographs").
 *
 * The <img> has its width and height and its box is sized by CSS, so nothing
 * moves when the picture arrives. Only a hero's picture loads with priority.
 */
export function ScenePhoto({ photo, priority = false, testId = 'scene-photo' }: { photo: Photo; priority?: boolean; testId?: string }) {
  const focusX = photo.bandX ?? photo.focus.split(' ')[0] ?? '75%'
  return (
    <div className="hero-photo" data-testid={testId}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP file in two sizes, served as it is */}
      <img
        src={`${photo.base}-2400.webp`}
        srcSet={`${photo.base}-1200.webp 1200w, ${photo.base}-2400.webp 2400w`}
        sizes="100vw"
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        style={{ '--focus': photo.focus, '--focus-x': focusX, '--band-y': photo.bandY } as React.CSSProperties}
      />
      <span className="hero-photo-fade" aria-hidden="true" />
    </div>
  )
}
