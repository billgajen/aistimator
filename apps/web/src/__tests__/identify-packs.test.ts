/**
 * T-140: the HVAC and water-heater packs are consistent data, and their
 * decode rules read typical plate transcriptions. Transcriptions below are
 * typical formats, not copied from any real plate (TODO-OWNER: re-run with
 * real nameplate photos, OWNER-TODO T-139/T-140).
 */
import { describe, it, expect } from 'vitest'
import { resolveIdentification, type ExpectedSignalConfig } from '@estimator/shared'
import { hvacPackUS } from '@/lib/vertical-packs/hvac-us'
import { waterHeaterPackUS } from '@/lib/vertical-packs/water-heater-us'
import { listPacks } from '@/lib/vertical-packs'

const packs = [hvacPackUS, waterHeaterPackUS]

function signal(key: string): ExpectedSignalConfig {
  for (const pack of packs)
    for (const svc of pack.services) {
      const found = svc.draft.expectedSignals.find((s) => s.signalKey === key)
      if (found) return found
    }
  throw new Error(`no signal ${key}`)
}

function decode(key: string, transcribed: string) {
  const es = signal(key)
  return resolveIdentification({
    signalKey: key,
    spec: es.identify!,
    signalType: es.type,
    possibleValues: es.possibleValues,
    reading: { targetKey: key, legible: true, transcribed },
  })?.value
}

describe('identify packs: data integrity', () => {
  for (const pack of packs) {
    for (const svc of pack.services) {
      it(`${pack.id} / ${svc.name}`, () => {
        const steps = svc.draft.pricing.workSteps
        expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
        expect(steps.length).toBeLessThanOrEqual(10) // draft bulk limit
        for (const step of steps.filter((s) => s.triggerSignal)) {
          const es = svc.draft.expectedSignals.find((s) => s.signalKey === step.triggerSignal)
          expect(es?.identify, `${step.id} triggers on an identified signal`).toBeTruthy()
          expect(es!.possibleValues).toContain(step.triggerCondition?.value)
        }
        // Every allowed value selects exactly one priced step per signal
        for (const es of svc.draft.expectedSignals.filter((s) => s.identify)) {
          for (const value of es.possibleValues || []) {
            const selected = steps.filter((s) => s.triggerSignal === es.signalKey && s.triggerCondition?.value === value)
            expect(selected.length, `${es.signalKey}=${value}`).toBe(1)
          }
        }
        // The plate/label is the first guided photo (triage reads only the first few)
        expect(svc.draft.media.requiredAngles?.[0]?.id).toMatch(/rating_(plate|label)/)
        expect(pack.region).toBe('US')
      })
    }
  }

  it('US businesses see the new packs; GB still sees its painting pack', () => {
    expect(listPacks('US').map((p) => p.id)).toEqual(
      expect.arrayContaining(['hvac-replacement-us', 'water-heater-us', 'painting-decorating-us'])
    )
    expect(listPacks('GB')[0]!.region).toBe('GB')
  })
})

describe('HVAC decode rules', () => {
  it.each([
    ['GSX140361KB', '3 ton'],
    ['4TTR4048L1000A', '4 ton'],
    ['ML14XC1-024-230A', '2 ton'],
    ['GSZ140601', '5 ton'],
    ['MODEL 25HCE430A003 NOMINAL 2.5 TONS', '2.5 ton'],
    ['M/N XR13 1.5 TON', '1.5 ton'],
  ])('%s → %s', (text, expected) => {
    expect(decode('ac_tonnage', text)).toBe(expected)
  })

  it('a model number without a known code decodes to nothing (customer is asked)', () => {
    expect(decode('ac_tonnage', 'RA1436AJ1NA')).toBeUndefined()
  })

  it.each([
    ['INPUT BTU/HR 80,000', '80,000'],
    ['INPUT 100000 BTUH OUTPUT 96000', '100,000'],
    ['Input: 60.000 BTU/h', '60,000'],
  ])('furnace %s → %s', (text, expected) => {
    expect(decode('furnace_input_btu', text)).toBe(expected)
  })
})

describe('water heater decode rules', () => {
  it('a gas power-vent label with a 120 V line is not read as electric', () => {
    expect(decode('water_heater_fuel', 'VOLTS 120 HZ 60')).toBeUndefined()
  })

  it.each([
    ['CAPACITY 50 U.S. GAL', '50 gal'],
    ['40 GAL  MODEL XG40T06EC36U1', '40 gal'],
    ['75 GALLONS', '75 gal'],
  ])('capacity %s → %s', (text, expected) => {
    expect(decode('tank_capacity', text)).toBe(expected)
  })

  it.each([
    ['FOR USE WITH NATURAL GAS ONLY', 'Natural gas'],
    ['NAT. GAS 40,000 BTU/HR', 'Natural gas'],
    ['PROPANE (LP) GAS', 'Propane'],
    ['240 V 4500 W', 'Electric'],
    ['VOLTS 240 WATTS 4500', 'Electric'],
  ])('fuel %s → %s', (text, expected) => {
    expect(decode('water_heater_fuel', text)).toBe(expected)
  })
})
