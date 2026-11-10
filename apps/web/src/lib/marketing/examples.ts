/**
 * T-154: the example request behind each marketing visual (home hero and each
 * trade page). Every price is read from the pack's own template rates, the
 * same ones a new business starts with, so a visual can never show a number
 * the product wouldn't produce. Pure; a unit test resolves every example.
 */
import type { VerticalPack } from '@/lib/vertical-packs/types'
import { garageDoorsPackUS } from '@/lib/vertical-packs/garage-doors-us'
import { waterHeaterPackUS } from '@/lib/vertical-packs/water-heater-us'
import { paintingPackUS } from '@/lib/vertical-packs/painting-us'
import { hvacPackUS } from '@/lib/vertical-packs/hvac-us'
import { plumbingPackUS } from '@/lib/vertical-packs/plumbing-us'
import { electricalPackUS } from '@/lib/vertical-packs/electrical-us'

export interface MarketingExample {
  serviceName: string
  /** What the customer answered, as the widget shows it */
  question: string
  answer: string
  /** Whether the customer added a photo (shown as a photo chip) */
  photo: string | null
  lines: Array<{ label: string; amount: number }>
  total: number
  customerName: string
}

interface Pick {
  pack: VerticalPack
  service: string
  question: string
  answer: string
  photo: string | null
  /** Work steps by exact name or name prefix, with a quantity */
  steps: Array<{ name: string; prefix?: boolean; qty?: number; label?: string }>
  baseFee?: boolean
  customerName: string
}

function build(p: Pick): MarketingExample {
  const svc = p.pack.services.find((s) => s.name === p.service)
  if (!svc) throw new Error(`No service "${p.service}" in ${p.pack.id}`)
  const lines = p.steps.map((want) => {
    const step = svc.draft.pricing.workSteps.find((s) => (want.prefix ? s.name.startsWith(want.name) : s.name === want.name))
    if (!step) throw new Error(`No step "${want.name}" in ${p.service}`)
    const qty = want.qty ?? 1
    return { label: want.label ?? (qty > 1 ? `${step.name} × ${qty}` : step.name), amount: step.defaultCost * qty }
  })
  if (p.baseFee && svc.draft.pricing.baseFee > 0) lines.push({ label: 'Visit and setup', amount: svc.draft.pricing.baseFee })
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
  return {
    serviceName: svc.name,
    question: p.question,
    answer: p.answer,
    photo: p.photo,
    lines,
    total: Math.max(subtotal, svc.draft.pricing.minimumCharge ?? 0),
    customerName: p.customerName,
  }
}

const PICKS: Record<string, Pick> = {
  'garage-doors': {
    pack: garageDoorsPackUS,
    service: 'Garage Door Spring Replacement',
    question: 'How many springs need replacing?',
    answer: 'Two',
    photo: null,
    steps: [{ name: 'Torsion spring replacement (pair)' }],
    customerName: 'Jordan M.',
  },
  'water-heaters': {
    pack: waterHeaterPackUS,
    service: 'Water Heater Replacement',
    question: 'Photo of the tank label',
    answer: '50 gal · natural gas',
    photo: 'Tank label',
    steps: [{ name: 'Drain, removal and haul-away' }, { name: '50 gal tank water heater' }, { name: 'Natural gas connection and venting' }],
    customerName: 'Priya S.',
  },
  painting: {
    pack: paintingPackUS,
    service: 'Interior Painting',
    question: 'How many rooms?',
    answer: '2',
    photo: null,
    steps: [{ name: 'Walls & ceilings', qty: 2, label: 'Walls & ceilings, 2 rooms' }],
    baseFee: true,
    customerName: 'Alex R.',
  },
  hvac: {
    pack: hvacPackUS,
    service: 'Central AC Replacement',
    question: 'Photo of the outdoor unit’s rating plate',
    answer: '3 ton',
    photo: 'Rating plate',
    steps: [{ name: 'Removal, recovery and disposal' }, { name: '3 ton', prefix: true }],
    customerName: 'Chris D.',
  },
  plumbing: {
    pack: plumbingPackUS,
    service: 'Fixture Replacement',
    question: 'How many toilets to replace?',
    answer: '2',
    photo: null,
    steps: [{ name: 'Toilet replacement', qty: 2, label: 'Toilet replacement, 2 toilets' }],
    customerName: 'Sam K.',
  },
  electrical: {
    pack: electricalPackUS,
    service: 'EV Charger Installation',
    question: 'Photo of the panel label',
    answer: '200 A panel',
    photo: 'Panel label',
    steps: [{ name: 'Level 2 charger installation' }],
    customerName: 'Taylor B.',
  },
}

/** The home page uses the demo's no-photo service */
export const HOME_EXAMPLE_TRADE = 'garage-doors'

export function marketingExample(trade: string = HOME_EXAMPLE_TRADE): MarketingExample {
  return build(PICKS[trade] ?? PICKS[HOME_EXAMPLE_TRADE]!)
}

export const EXAMPLE_TRADES = Object.keys(PICKS)
