import { describe, it, expect } from 'vitest'
import { formatScopeAnswers } from '../ai/scope-answers'

describe('formatScopeAnswers', () => {
  const fields = [
    { fieldId: 'sides', label: 'Which sides to paint?', options: [{ value: 'front_only', label: 'Front only' }] },
    { fieldId: 'storeys', label: 'Storeys', options: ['1', '2'] },
    { fieldId: 'extras', label: 'Extras', options: [{ value: 'gutters', label: 'Gutters' }, { value: 'fascia', label: 'Fascia' }] },
  ]

  it('labels answers with the business question and option labels', () => {
    const lines = formatScopeAnswers(
      [
        { fieldId: 'sides', value: 'front_only' },
        { fieldId: 'storeys', value: 2 },
        { fieldId: 'extras', value: ['gutters', 'fascia'] },
      ],
      fields
    )
    expect(lines).toEqual(['- Which sides to paint?: Front only', '- Storeys: 2', '- Extras: Gutters, Fascia'])
  })

  it('puts the description last, skips other internal and empty answers', () => {
    const lines = formatScopeAnswers(
      [
        { fieldId: '_project_description', value: 'Front   of the house\nonly' },
        { fieldId: '_source', value: 'widget' },
        { fieldId: 'sides', value: '' },
        { fieldId: 'unknown_field', value: true },
      ],
      fields
    )
    expect(lines).toEqual(['- unknown_field: Yes', `- Customer's description: "Front of the house only"`])
  })

  it('clips long free text', () => {
    const lines = formatScopeAnswers([{ fieldId: 'description', value: 'x'.repeat(2000) }])
    expect(lines[0]!.length).toBeLessThan(700)
  })
})
