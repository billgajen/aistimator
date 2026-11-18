/**
 * T-154: the example request behind each marketing visual (home hero and each
 * trade page). Every price is read from the pack's own template rates, the
 * same ones a new business starts with, so a visual can never show a number
 * the product wouldn't produce. Pure; a unit test resolves every example.
 */
import type { VerticalPack } from '../vertical-packs/types'
import { garageDoorsPackUS } from '../vertical-packs/garage-doors-us'
import { waterHeaterPackUS } from '../vertical-packs/water-heater-us'
import { paintingPackUS } from '../vertical-packs/painting-us'
import { hvacPackUS } from '../vertical-packs/hvac-us'
import { plumbingPackUS } from '../vertical-packs/plumbing-us'
import { electricalPackUS } from '../vertical-packs/electrical-us'

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
  /**
   * T-167: what the product reads off the customer's photo for this trade: a
   * value of a signal the template identifies from a label, and where the
   * template says it is read from. Null for a trade whose template reads no
   * label (Docs/design/ai-capabilities.md, section 5).
   */
  reading: { value: string; readFrom: string } | null
  /** T-167: the question the trade page's form shows: one of the template's own fields, with one of its own answers */
  form: { question: string; answer: string }
  /** T-167: the service's starting prices as the template sets them (setup's "Check your prices"), the first five */
  priceList: Array<{ label: string; amount: number }>
  /** T-167: a quantity the template has measured from photos, priced at the template's rate (painting only) */
  measured: { item: string; quantity: number; unit: string; rate: number; amount: number } | null
  /** T-167: an extra the template sells that a customer's own words can add, at the template's price */
  extra: { label: string; amount: number; phrase: string; service: string } | null
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
  /** T-167: the template's own question shown on the trade page's form, and one of its own answers */
  form?: { fieldId: string; answer: string }
  /** T-167: the value read from the label in this example (must be one the template allows) */
  reads?: string
  /** T-167: a photo-measured step of one of the pack's services, and the quantity shown */
  measured?: { service: string; step: string; quantity: number }
  /** T-167: an add-on of one of the pack's services, and words of the customer's that trigger it */
  extra?: { service: string; addon: string; phrase: string }
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

  // T-167: the form's question is one of the template's own fields
  let form = { question: p.question, answer: p.answer }
  if (p.form) {
    const field = (svc.draft.suggestedFields ?? []).find((f) => f.fieldId === p.form!.fieldId)
    if (!field || (field.options && !field.options.includes(p.form.answer))) throw new Error(`"${p.service}" has no field ${p.form.fieldId} that can answer "${p.form.answer}"`)
    form = { question: field.label, answer: p.form.answer }
  }

  // T-167: the label this template reads, from its own identification rules
  let reading: MarketingExample['reading'] = null
  if (p.reads) {
    const signal = (svc.draft.expectedSignals ?? []).find((es) => es.identify?.readFrom && es.possibleValues?.includes(p.reads!))
    if (!signal?.identify) throw new Error(`"${p.service}" reads no label that can say "${p.reads}"`)
    reading = { value: p.reads, readFrom: signal.identify.readFrom }
  }

  // T-167: a step the template measures from photos, at the template's rate
  let measured: MarketingExample['measured'] = null
  if (p.measured) {
    const from = p.pack.services.find((s) => s.name === p.measured!.service)
    const step = from?.draft.pricing.workSteps.find((s) => s.name === p.measured!.step)
    if (!step || step.quantitySource?.type !== 'ai_signal') throw new Error(`"${p.measured.step}" is not measured from photos in ${p.measured.service}`)
    measured = { item: step.name, quantity: p.measured.quantity, unit: step.unitLabel ?? '', rate: step.defaultCost, amount: Math.round(step.defaultCost * p.measured.quantity * 100) / 100 }
  }

  // T-167: an extra the template sells, which the customer's own words can add
  let extra: MarketingExample['extra'] = null
  if (p.extra) {
    const from = p.pack.services.find((s) => s.name === p.extra!.service)
    const addon = from?.addons?.find((a) => a.label === p.extra!.addon)
    const heard = addon?.triggerKeywords?.some((k) => p.extra!.phrase.toLowerCase().includes(k.toLowerCase()))
    if (!addon || !heard) throw new Error(`"${p.extra.addon}" is not an extra of ${p.extra.service} that "${p.extra.phrase}" asks for`)
    extra = { label: addon.label, amount: addon.price, phrase: p.extra.phrase, service: p.extra.service }
  }

  return {
    serviceName: svc.name,
    question: p.question,
    answer: p.answer,
    photo: p.photo,
    lines,
    total: Math.max(subtotal, svc.draft.pricing.minimumCharge ?? 0),
    customerName: p.customerName,
    reading,
    form,
    priceList: svc.draft.pricing.workSteps.slice(0, 5).map((s) => ({ label: s.name, amount: s.defaultCost })),
    measured,
    extra,
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
    customerName: 'Megan G.',
    reads: '50 gal',
    form: { fieldId: 'heater_location', answer: 'Garage' },
  },
  painting: {
    pack: paintingPackUS,
    service: 'Interior Painting',
    question: 'How many rooms?',
    // T-181: three rooms, the number in the customer's message on Home ("three bedrooms"); it was 2,
    // so the price breakdown beside that message priced a different job. The total follows the template's rates.
    answer: '3',
    photo: null,
    steps: [{ name: 'Walls & ceilings', qty: 3, label: 'Walls & ceilings, 3 rooms' }],
    baseFee: true,
    customerName: 'Alex R.',
    measured: { service: 'Exterior Painting', step: 'Exterior walls', quantity: 920 },
    extra: { service: 'Interior Painting', addon: 'Trim, doors & baseboards', phrase: 'and the trim too' },
  },
  hvac: {
    pack: hvacPackUS,
    service: 'Central AC Replacement',
    question: 'Photo of the outdoor unit’s rating plate',
    answer: '3 ton',
    photo: 'Rating plate',
    steps: [{ name: 'Removal, recovery and disposal' }, { name: '3 ton', prefix: true }],
    customerName: 'Chris D.',
    reads: '3 ton',
    form: { fieldId: 'indoor_location', answer: 'Basement' },
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
    reads: '200 A',
    form: { fieldId: 'charger_supply', answer: 'Please supply one' },
  },
}

/** The home page uses the demo's no-photo service */
export const HOME_EXAMPLE_TRADE = 'garage-doors'

export function marketingExample(trade: string = HOME_EXAMPLE_TRADE): MarketingExample {
  return build(PICKS[trade] ?? PICKS[HOME_EXAMPLE_TRADE]!)
}

export const EXAMPLE_TRADES = Object.keys(PICKS)
