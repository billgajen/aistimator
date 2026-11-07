// T-134: create (or reuse) the Stripe products + prices for the offered plans,
// straight from packages/shared/src/plans.ts, and print the env lines to paste.
//
//   STRIPE_SECRET_KEY=sk_test_... (cd apps/web && npx tsx scripts/stripe-setup-plans.mts)
//
// Idempotent: prices are found by lookup_key before anything is created.
// Run it in TEST mode first; it refuses live keys unless --live is passed.
import Stripe from 'stripe'
import { offeredPlans, stripePriceEnvKey, type PlanInterval } from '../../../packages/shared/src/plans'

const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('Set STRIPE_SECRET_KEY')
if (key.startsWith('sk_live_') && !process.argv.includes('--live')) throw new Error('Live key detected — pass --live to confirm')
const stripe = new Stripe(key)

const lines: string[] = []
for (const plan of offeredPlans()) {
  for (const [currency, monthlyCents] of Object.entries(plan.monthlyPrice)) {
    const variants: Array<[PlanInterval, number | undefined]> = [
      ['monthly', monthlyCents],
      ['annual', plan.annualPrice?.[currency]],
    ]
    for (const [interval, amount] of variants) {
      if (!amount) continue
      const lookupKey = `${plan.id}_${interval}_${currency.toLowerCase()}`
      const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
      let price = existing.data[0]
      if (!price) {
        const products = await stripe.products.search({ query: `metadata['plan_id']:'${plan.id}'` })
        const product =
          products.data[0] ??
          (await stripe.products.create({ name: `Aistimator ${plan.name}`, metadata: { plan_id: plan.id } }))
        price = await stripe.prices.create({
          product: product.id,
          currency: currency.toLowerCase(),
          unit_amount: amount,
          recurring: { interval: interval === 'annual' ? 'year' : 'month' },
          lookup_key: lookupKey,
          metadata: { plan_id: plan.id, interval },
        })
        console.log(`created ${lookupKey} → ${price.id}`)
      } else {
        console.log(`exists  ${lookupKey} → ${price.id}`)
      }
      lines.push(`${stripePriceEnvKey(plan.id, interval, currency)}=${price.id}`)
    }
  }
}
console.log('\n# Paste into Vercel env (web app):\n' + lines.join('\n'))
