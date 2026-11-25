// T-204: the AC Tune-Up service exactly as "Describe your pricing" compiled it for the test
// business (read from production on 25 Nov 2026, read-only; nothing of a customer is in it).
// Used by the unit tests and by verify-t204: the same lines and questions, priced by the engine.
export const AC_TUNE_UP_TEXT =
  'AC tune-up is $129 for the first system and $89 for each additional system. Add $45 if the system is in an attic. Refrigerant top-up is $95 per pound, only if needed. Weekd visits add $60.'

export const AC_TUNE_UP_STEPS = [
  { id: 'ac_tune_up_first_system', name: 'AC Tune-Up (First System)', description: 'AC Tune-Up (First System)', costType: 'per_unit', optional: false, unitLabel: 'system', defaultCost: 129, quantitySource: { type: 'derived', formula: 'min(system_count, 1)' } },
  { id: 'ac_tune_up_additional_systems', name: 'AC Tune-Up (Additional Systems)', description: 'AC Tune-Up (Additional Systems)', costType: 'per_unit', optional: false, unitLabel: 'system', defaultCost: 89, quantitySource: { type: 'derived', formula: 'max(0, system_count - 1)' } },
  { id: 'attic_unit_surcharge', name: 'Attic unit surcharge', description: 'Attic unit surcharge', costType: 'fixed', optional: true, defaultCost: 45, when: { fieldId: 'indoor_location', operator: 'equals', equals: 'Attic' } },
  { id: 'weekend_visit_surcharge', name: 'Weekend visit surcharge', description: 'Weekend visit surcharge', costType: 'fixed', optional: true, defaultCost: 60, when: { fieldId: 'weekend_visit', operator: 'equals', equals: true } },
  { id: 'refrigerant_top_up', name: 'Refrigerant top-up', description: 'Refrigerant top-up', costType: 'per_unit', optional: true, unitLabel: 'lb', defaultCost: 95, quantitySource: { type: 'form_field', fieldId: 'refrigerant_lbs', missingMeansZero: true } },
] as const

export const AC_TUNE_UP_FIELDS = [
  { type: 'number', label: 'Number of AC Systems', fieldId: 'system_count', required: true, criticalForPricing: true },
  { type: 'radio', label: 'Is your AC currently cooling?', fieldId: 'system_operational', options: ['Yes, it is running normally', 'No, it is not cooling / broken'], required: true, criticalForPricing: true },
  { type: 'dropdown', label: 'Indoor Unit Location', fieldId: 'indoor_location', options: ['Basement', 'Attic', 'Closet / Interior Room', 'Garage', 'Crawlspace'], required: true, criticalForPricing: true },
  { type: 'boolean', label: 'Do you require a weekend visit?', fieldId: 'weekend_visit', required: true, criticalForPricing: true },
  { type: 'number', label: 'Estimated pounds of refrigerant needed — if you know it', fieldId: 'refrigerant_lbs', required: false, criticalForPricing: false },
  { type: 'dropdown', label: 'When was the system last serviced?', fieldId: 'last_service_date', options: ['Within the last year', '1-2 years ago', '3+ years ago', 'Never / Unsure'], required: false, criticalForPricing: false },
  { type: 'text', label: 'Additional Notes or Symptoms', fieldId: 'customer_notes', required: false, criticalForPricing: false },
] as const

/** The ticket's proof: the answers, and the price before tax each must give */
export const AC_TUNE_UP_CASES = [
  { what: '1 system, basement, weekday, refrigerant left empty', answers: { system_count: 1, indoor_location: 'Basement', weekend_visit: false }, subtotal: 129 },
  { what: '2 systems, one in the attic', answers: { system_count: 2, indoor_location: 'Attic', weekend_visit: false }, subtotal: 263 },
  { what: '2 systems, attic, weekend', answers: { system_count: 2, indoor_location: 'Attic', weekend_visit: true }, subtotal: 323 },
  { what: '1 system, refrigerant typed as 0', answers: { system_count: 1, indoor_location: 'Basement', weekend_visit: false, refrigerant_lbs: 0 }, subtotal: 129 },
  { what: '1 system, 2 lb of refrigerant', answers: { system_count: 1, indoor_location: 'Basement', weekend_visit: false, refrigerant_lbs: 2 }, subtotal: 319 },
] as const
