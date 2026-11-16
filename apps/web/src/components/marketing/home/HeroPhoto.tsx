import { HERO_PHOTO, heroPhotoSrc } from '@/lib/marketing/hero-photo'

/**
 * The home page's hero photograph (T-168; system.md, Imagery).
 *
 * From 768 px it is the full-width background of the hero band, fading into
 * paper on the left where the words are, with the painter on the right and
 * the three demo frames half on it. Under 768 px it fills the top of the
 * band and fades down into paper, and the headline starts over the faded
 * part (T-170: it is never a block of its own above the headline). The styles
 * are in globals.css ("scene photographs").
 *
 * The <img> has its width and height and its box is sized by CSS, so nothing
 * moves when the picture arrives. It loads at once, with high priority.
 */
export function HeroPhoto() {
  return (
    <div className="hero-photo" data-testid="hero-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP file in two sizes, served as it is */}
      <img
        src={heroPhotoSrc(2400)}
        srcSet={`${heroPhotoSrc(1200)} 1200w, ${heroPhotoSrc(2400)} 2400w`}
        sizes="100vw"
        width={HERO_PHOTO.width}
        height={HERO_PHOTO.height}
        alt={HERO_PHOTO.alt}
        decoding="async"
        loading="eager"
        fetchPriority="high"
        style={{ '--focus': HERO_PHOTO.focus, '--focus-x': HERO_PHOTO.focus.split(' ')[0], '--band-y': HERO_PHOTO.bandY } as React.CSSProperties}
      />
      <span className="hero-photo-fade" aria-hidden="true" />
    </div>
  )
}
