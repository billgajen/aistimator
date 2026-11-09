// Automated triage checks per scenario. Levels: fail = hard defect,
// warn = needs human judgement, info = context for the report.
// Deep verification (penny recompute vs config, takeoff sanity) happens in
// the manual analysis pass over the dumped JSON.

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

function breakdownLabels(quote) {
  return (quote?.pricing?.breakdown || []).map((l) => `${l.label}`.toLowerCase())
}

export function commonChecks(scenario, quote) {
  const out = []
  const add = (level, name, detail) => out.push({ level, name, detail })

  const status = quote?.status
  if (['sent', 'viewed', 'accepted'].includes(status)) add('pass', 'reached final quote', `status=${status}`)
  else if (status === 'pending_review') add('warn', 'stuck at pending_review', 'quality gate routed to human review')
  else if (status === 'awaiting_clarification') add('warn', 'still awaiting clarification', 'clarify round did not finalize')
  else add('fail', 'did not reach a final quote', `status=${status}`)

  const p = quote?.pricing
  if (p && Array.isArray(p.breakdown) && p.breakdown.length > 0) {
    const sum = p.breakdown.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    if (near(sum, p.subtotal)) add('pass', 'breakdown sums to subtotal', `${sum.toFixed(2)} == ${p.subtotal}`)
    else add('fail', 'breakdown does not sum to subtotal', `sum=${sum.toFixed(2)} subtotal=${p.subtotal}`)
    const expectedTotal = p.subtotal + (Number(p.taxAmount) || 0)
    if (near(expectedTotal, p.total)) add('pass', 'total = subtotal + tax', `${p.total}`)
    else add('fail', 'total != subtotal + tax', `subtotal=${p.subtotal} tax=${p.taxAmount} total=${p.total}`)
  } else if (['sent', 'viewed'].includes(status)) {
    add('fail', 'final quote has no pricing breakdown', JSON.stringify(p).slice(0, 200))
  }

  const grade = p?.estimate?.grade
  if (['sent', 'viewed'].includes(status)) {
    if (['A', 'B', 'C'].includes(grade)) add('pass', 'estimate grade present', `grade=${grade} range=${p.estimate.rangeLow}-${p.estimate.rangeHigh}`)
    else add('fail', 'estimate grade missing on final quote', JSON.stringify(p?.estimate))
    if (typeof quote.reference === 'string' && /^EST-\d{4}-/.test(quote.reference)) add('pass', 'reference number present', quote.reference)
    else add('warn', 'reference missing/odd', String(quote.reference))
    if (scenario.expect.needsPhotos) {
      if (Array.isArray(quote.takeoff) && quote.takeoff.length > 0) add('pass', 'takeoff table present', `${quote.takeoff.length} rows`)
      else add('warn', 'no takeoff table on a measured scenario', '')
    }
  }
  return out
}

export function scenarioChecks(scenario, quote, detail) {
  const out = []
  const add = (level, name, det) => out.push({ level, name, detail: det })
  const total = quote?.pricing?.total ?? null
  const labels = breakdownLabels(quote)
  const allText = JSON.stringify(quote ?? {}).toLowerCase()
  const e = scenario.expect
  const cur = scenario.currency === 'USD' ? '$' : '£'

  if (e.approxTotalRange && total != null && total > 0) {
    const [lo, hi] = e.approxTotalRange
    if (total >= lo && total <= hi) add('pass', `total within expected band ${cur}${lo}–${cur}${hi}`, `${cur}${total}`)
    else add('warn', `total outside expected band ${cur}${lo}–${cur}${hi}`, `${cur}${total}`)
  }
  if (e.minTotal && total != null && total > 0) {
    if (total >= e.minTotal) add('pass', `total >= hand-computed floor £${e.minTotal}`, `£${total}`)
    else add('fail', `total below hand-computed floor £${e.minTotal}`, `£${total}`)
  }

  switch (scenario.id) {
    case 'S01':
      if (total != null && total > 0 && total < 350) add('fail', 'minimum job £350 not enforced', `£${total}`)
      break
    case 'S03': {
      const hasDiscount = labels.some((l) => l.includes('discount'))
      const sub = quote?.pricing?.subtotal ?? 0
      if (hasDiscount && sub < 5000) add('fail', 'discount applied below £5,000 threshold', `subtotal=£${sub}`)
      else add('pass', 'discount threshold respected', `subtotal=£${sub} discount=${hasDiscount}`)
      if (labels.length >= 3) add('pass', 'itemised into 3+ lines as requested', labels.join(' | '))
      else add('warn', 'fewer than 3 line items for a 3-part job', labels.join(' | '))
      break
    }
    case 'S04':
      if (labels.some((l) => /suv|7[- ]?seat|large/.test(l)) || allText.includes('95')) add('pass', '7-seater class appears to be used', '')
      else add('warn', 'cannot confirm 7-seater rate was selected', labels.join(' | '))
      break
    case 'S09':
      if (/hoist|window extraction/.test(labels.join(' '))) add('fail', 'hoist/window extraction was priced — it is survey-only', '')
      else add('pass', 'hoist not priced (survey-only exclusion held)', '')
      break
    case 'S10': {
      const priced = labels.filter((l) => /pigeon|bird|spike/.test(l))
      if (priced.length) add('fail', 'bird proofing appears as a priced line', priced.join(' | '))
      else add('pass', 'bird proofing not priced (hard exclusion held)', '')
      break
    }
    case 'S07': {
      const clarified = (detail?.clarificationLog || []).length > 0
      const bothOptions = /reduction/.test(allText) && /removal/.test(allText)
      if (clarified || bothOptions) add('pass', 'either/or ambiguity surfaced (clarified or both options addressed)', clarified ? 'clarification asked' : 'both options in quote')
      else add('warn', 'ambiguity may have been silently guessed', '')
      break
    }
    case 'S08':
      if (labels.filter((l) => l.includes('window')).length >= 2) add('pass', 'storey-tiered window lines present', labels.join(' | '))
      else add('warn', 'expected two window rate tiers in breakdown', labels.join(' | '))
      break
  }
  return out
}
