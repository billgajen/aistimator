/**
 * T-170: the scene photographs of the marketing pages, other than Home's
 * hero (lib/marketing/hero-photo.ts). Each was made with an image model
 * under the rules in Docs/design/system.md (Imagery): a situation, never a
 * customer; no brand, no text and no screen drawn by the model; real alt
 * text, no caption. How each was made, what was changed in it and what was
 * rejected is in Docs/design/photos.md.
 *
 * `width` and `height` are those of the largest file, so a page keeps its
 * shape while the picture loads. `focus` is where the subject sits, for the
 * phone's crop. From 768 px the subject stays `bandX` across the picture's
 * box at every width (`focus`'s first number when `bandX` is not given).
 */
export interface ScenePhoto {
  /** The file's path without its width: `${base}-1200.webp`, `${base}-2400.webp` */
  base: string
  width: number
  height: number
  /** What the picture shows, for a screen reader (no caption is shown) */
  alt: string
  /** Where the subject sits (CSS object-position): across, then down */
  focus: string
  /** How far across the subject stays from 768 px, when that differs from the phone's crop */
  bandX?: string
  /** How far down the picture a wide band looks (it is wider than the picture, so it shows a strip of it) */
  bandY: string
}

export const scenePhotoSrc = (photo: ScenePhoto, width: 1200 | 2400) => `${photo.base}-${width}.webp`

/** One per trade page, by its slug (lib/marketing/trades.ts) */
export const TRADE_PHOTOS: Record<string, ScenePhoto> = {
  painting: {
    base: '/photos/trade-painting',
    width: 2400,
    height: 1340,
    alt: 'The front of a freshly painted house: pale siding, white trim and a dark green front door, with a ladder against the wall and a drop cloth and a paint can on the porch.',
    focus: '92% 55%',
    bandX: '76%',
    bandY: '62%',
  },
  hvac: {
    base: '/photos/trade-hvac',
    width: 2400,
    height: 1340,
    alt: 'An air conditioner’s outdoor unit on a concrete pad beside the pale siding of a house, with its lines running up the wall.',
    focus: '72% 55%',
    bandY: '58%',
  },
  'water-heaters': {
    base: '/photos/trade-water-heaters',
    width: 2400,
    height: 1340,
    alt: 'A tall white water heater tank in the corner of a garage, with copper pipes and a vent rising from its top.',
    focus: '72% 45%',
    bandY: '30%',
  },
  plumbing: {
    base: '/photos/trade-plumbing',
    width: 2400,
    height: 1340,
    alt: 'A plumber in a green work shirt leans over a kitchen sink, tightening the tap with a wrench; a canvas tool bag sits on the counter.',
    focus: '76% 35%',
    bandY: '22%',
  },
  electrical: {
    base: '/photos/trade-electrical',
    width: 2400,
    height: 1032,
    alt: 'An electrician in a grey work shirt holds open the door of an electrical panel on a garage wall and looks inside.',
    focus: '93% 40%',
    bandX: '80%',
    bandY: '35%',
  },
  'garage-doors': {
    base: '/photos/trade-garage-doors',
    width: 2400,
    height: 1340,
    alt: 'A closed white garage door on the front of a house, seen from the driveway, with a lamp beside it.',
    focus: '77% 50%',
    bandY: '45%',
  },
}

/** Home's closing band: the one evening picture */
export const CLOSING_PHOTO: ScenePhoto = {
  base: '/photos/closing',
  width: 2400,
  height: 1340,
  alt: 'In the evening, someone sits back on a sofa beside a lit lamp, looking down at a phone.',
  focus: '74% 40%',
  bandY: '38%',
}

/**
 * "Add it anywhere": the side of a plain white van. The QR code is ours, placed
 * on the van's flat panel in code (`sign` is that panel, as shares of the
 * picture); the image model drew no code and no lettering.
 */
export const VAN_PHOTO = {
  src: '/photos/van-1000.webp',
  srcSmall: '/photos/van-500.webp',
  width: 1000,
  height: 1600,
  smallWidth: 500,
  alt: 'The side of a plain white work van parked on a residential street.',
  sign: { top: '24.5%', left: '7%', width: '86%', height: '20%' },
} as const
