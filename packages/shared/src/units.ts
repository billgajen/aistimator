/**
 * Unit conversion (T-133, AD-025).
 *
 * Metric is the canonical internal unit for geometry (measurement passes,
 * scan dimensions, reference tables). Conversion happens at the edges: where
 * a measured quantity binds to a priced unit, and where values are shown to
 * or typed by people. Pure functions, no trade knowledge.
 */

import type { UnitSystem } from './regions/types'

export type UnitKind = 'length' | 'area' | 'volume'

export type UnitId =
  | 'm' | 'cm' | 'mm' | 'ft' | 'in' | 'yd'
  | 'sqm' | 'sqft' | 'sqyd'
  | 'l' | 'gal' | 'cum' | 'cuft' | 'cuyd'

interface UnitDef {
  kind: UnitKind
  /** Factor to the canonical metric unit of its kind (m, sqm, l) */
  toCanonical: number
  /** Short display label */
  label: string
}

const FT = 0.3048
const IN = 0.0254
const YD = 0.9144
const US_GAL_L = 3.785411784

const UNITS: Record<UnitId, UnitDef> = {
  m: { kind: 'length', toCanonical: 1, label: 'm' },
  cm: { kind: 'length', toCanonical: 0.01, label: 'cm' },
  mm: { kind: 'length', toCanonical: 0.001, label: 'mm' },
  ft: { kind: 'length', toCanonical: FT, label: 'ft' },
  in: { kind: 'length', toCanonical: IN, label: 'in' },
  yd: { kind: 'length', toCanonical: YD, label: 'yd' },
  sqm: { kind: 'area', toCanonical: 1, label: 'sqm' },
  sqft: { kind: 'area', toCanonical: FT * FT, label: 'sq ft' },
  sqyd: { kind: 'area', toCanonical: YD * YD, label: 'sq yd' },
  l: { kind: 'volume', toCanonical: 1, label: 'L' },
  gal: { kind: 'volume', toCanonical: US_GAL_L, label: 'gal' },
  cum: { kind: 'volume', toCanonical: 1000, label: 'm³' },
  cuft: { kind: 'volume', toCanonical: FT * FT * FT * 1000, label: 'cu ft' },
  cuyd: { kind: 'volume', toCanonical: YD * YD * YD * 1000, label: 'cu yd' },
}

/** Free-text spellings found in configs, prompts and customer input */
const ALIASES: Record<string, UnitId> = {
  m: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm', linearm: 'm', lm: 'm', linearmetre: 'm', linearmeter: 'm',
  cm: 'cm', mm: 'mm',
  ft: 'ft', foot: 'ft', feet: 'ft', linearft: 'ft', lf: 'ft', linearfoot: 'ft', linearfeet: 'ft',
  in: 'in', inch: 'in', inches: 'in',
  yd: 'yd', yard: 'yd', yards: 'yd',
  sqm: 'sqm', m2: 'sqm', squaremetre: 'sqm', squaremeter: 'sqm', squaremetres: 'sqm', squaremeters: 'sqm',
  sqft: 'sqft', ft2: 'sqft', squarefoot: 'sqft', squarefeet: 'sqft', sf: 'sqft',
  sqyd: 'sqyd', squareyard: 'sqyd', squareyards: 'sqyd',
  l: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  cum: 'cum', m3: 'cum', cubicmetre: 'cum', cubicmeter: 'cum',
  cuft: 'cuft', ft3: 'cuft', cubicfoot: 'cuft', cubicfeet: 'cuft',
  cuyd: 'cuyd', yd3: 'cuyd', cubicyard: 'cuyd', cubicyards: 'cuyd',
}

/** Map a free-text unit ("sq_ft", "linear_m", "Square Metres") to a UnitId, or null. */
export function normalizeUnit(raw: string | null | undefined): UnitId | null {
  if (!raw) return null
  const key = raw.toLowerCase().replace(/²/g, '2').replace(/³/g, '3').replace(/[^a-z0-9]/g, '')
  return ALIASES[key] ?? null
}

export function unitKind(raw: string | null | undefined): UnitKind | null {
  const id = normalizeUnit(raw)
  return id ? UNITS[id].kind : null
}

/**
 * Convert between two units of the same kind. Returns null when either unit
 * is unknown or the kinds differ (never guesses).
 */
export function convertUnit(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const f = normalizeUnit(from)
  const t = normalizeUnit(to)
  if (!f || !t || !Number.isFinite(value)) return null
  if (f === t) return value
  const fd = UNITS[f]
  const td = UNITS[t]
  if (fd.kind !== td.kind) return null
  return (value * fd.toCanonical) / td.toCanonical
}

/** Convert a metric canonical value (m, sqm, l) into the given unit. */
export function fromCanonical(value: number, kind: UnitKind, to: string): number | null {
  const canonical: Record<UnitKind, UnitId> = { length: 'm', area: 'sqm', volume: 'l' }
  return convertUnit(value, canonical[kind], to)
}

/** The unit a person expects for a kind of quantity in a unit system. */
export function preferredUnit(kind: UnitKind, system: UnitSystem): UnitId {
  if (system === 'imperial') {
    return kind === 'length' ? 'ft' : kind === 'area' ? 'sqft' : 'gal'
  }
  return kind === 'length' ? 'm' : kind === 'area' ? 'sqm' : 'l'
}

/** Short display label for a unit; unknown units pass through unchanged. */
export function unitDisplayLabel(raw: string): string {
  const id = normalizeUnit(raw)
  return id ? UNITS[id].label : raw
}

/** Round to a sensible precision for display/storage (1 dp, or 2 dp below 10). */
export function roundQuantity(value: number): number {
  const places = Math.abs(value) < 10 ? 2 : 1
  const f = 10 ** places
  return Math.round(value * f) / f
}
