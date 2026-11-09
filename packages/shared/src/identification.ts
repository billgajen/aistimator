/**
 * Identification signals (T-139, AD-029) — pure code, no IO.
 *
 * For identify-and-replace trades the price depends on WHAT the equipment is
 * (capacity, fuel, tonnage), not on its size. Vision transcribes the label or
 * nameplate verbatim; CODE decodes the transcription with the pack's tables
 * (AD-024: AI reads, code calculates). The model's own reading is used only
 * when no decode rule matches, and only if it is one of the allowed values.
 *
 * Everything trade-specific (where the value is printed, decode patterns,
 * option lists) is pack DATA on the expected signal. Nothing here knows any
 * trade.
 */

/** One decoding rule: a pattern over the transcribed label text. */
export interface IdentificationDecodeRule {
  /** Regular expression source, applied case-insensitively to the transcription */
  pattern: string
  /** Capture group holding the code (default 1; 0 = the whole match) */
  group?: number
  /** Code → value table (e.g. {"036": "3 ton"}). Checked before `scale`. */
  map?: Record<string, string | number>
  /** Numeric codes: value = Number(code) × scale (e.g. 36 × (1/12) = 3) */
  scale?: number
  /** Round a scaled value to this many decimals (default 2) */
  decimals?: number
  /** Constant result when the pattern matches (e.g. "NAT GAS" or "NG" → "Natural gas") */
  value?: string | number
  /** Short audit label, e.g. "capacity digits in the model number" */
  label?: string
}

/** Pack data on an expected signal that is identified from labels/nameplates. */
export interface IdentificationSpec {
  /** Where the value is printed — goes into the vision prompt ("the outdoor unit's rating plate") */
  readFrom: string
  /** What to transcribe verbatim (default: the text relevant to this value, e.g. "the model number") */
  transcribe?: string
  /** Decoding rules, first match wins */
  decode?: IdentificationDecodeRule[]
}

/** The model's raw output for one identification target. */
export interface IdentificationReading {
  targetKey: string
  /** Whether the label/plate was readable */
  legible: boolean
  /** Verbatim text transcribed from the label (what the code decodes) */
  transcribed?: string | null
  /** The model's direct reading of the value, used only when no rule decodes */
  value?: string | number | null
  /** 1-based photo index the label was read from */
  photo?: number | null
}

export interface ResolvedIdentification {
  signalKey: string
  value: string | number
  /** 'decoded' = a pack rule decoded the transcription; 'read' = printed directly / model reading */
  method: 'decoded' | 'read'
  confidence: number
  /** Customer-facing audit line, e.g. 'Read from the rating plate (photo 2): "GSX140361" → 3' */
  evidence: string
  /** Verbatim transcription, clipped */
  transcribed?: string
}

/** Confidence for a value decoded by a pack rule from a legible transcription */
export const IDENTIFICATION_DECODED_CONFIDENCE = 0.9
/** Confidence for a value read directly (no rule matched) */
export const IDENTIFICATION_READ_CONFIDENCE = 0.75

const MAX_TRANSCRIPTION_CHARS = 80

// Spaces, underscores, hyphens and thousands commas don't change meaning;
// a decimal point does ("1.5" is not "15")
const normaliseKey = (v: string) => v.toLowerCase().replace(/[\s_\-,]+/g, '')

/**
 * Snap a value onto the signal's allowed values (case/space/underscore-blind).
 * No allowed values → returned as-is. Not allowed → null.
 */
export function matchPossibleValue(
  value: string | number,
  possibleValues: string[] | undefined
): string | number | null {
  if (!possibleValues || possibleValues.length === 0) return value
  const target = normaliseKey(String(value))
  return possibleValues.find((p) => normaliseKey(p) === target) ?? null
}

/** Apply decode rules to a transcription (pure). First matching rule wins. */
export function decodeTranscription(
  transcribed: string,
  rules: IdentificationDecodeRule[]
): { value: string | number; rule: IdentificationDecodeRule; code: string } | null {
  for (const rule of rules) {
    let re: RegExp
    try {
      re = new RegExp(rule.pattern, 'i')
    } catch {
      continue // a malformed pack pattern is skipped, never fatal
    }
    const match = re.exec(transcribed)
    if (!match) continue
    if (rule.value !== undefined) return { value: rule.value, rule, code: match[0] }
    const code = match[rule.group ?? 1]
    if (code === undefined) continue

    if (rule.map) {
      const mapped = rule.map[code] ?? rule.map[code.toUpperCase()] ?? rule.map[code.toLowerCase()]
      if (mapped !== undefined) return { value: mapped, rule, code }
      if (rule.scale === undefined) continue
    }
    if (rule.scale !== undefined) {
      const n = Number(code)
      if (!Number.isFinite(n)) continue
      const factor = 10 ** (rule.decimals ?? 2)
      return { value: Math.round(n * rule.scale * factor) / factor, rule, code }
    }
    if (!rule.map) return { value: code, rule, code }
  }
  return null
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_TRANSCRIPTION_CHARS ? `${flat.slice(0, MAX_TRANSCRIPTION_CHARS - 1)}…` : flat
}

/**
 * Turn one reading into a usable value, or null when nothing trustworthy was
 * read. Order: pack decode of the transcription → the model's direct reading.
 * Either way the value must be one of the signal's allowed values (enum) or a
 * positive finite number (number).
 */
export function resolveIdentification(opts: {
  signalKey: string
  spec: IdentificationSpec
  signalType: 'number' | 'enum' | 'boolean' | 'string'
  possibleValues?: string[]
  reading: IdentificationReading | undefined
}): ResolvedIdentification | null {
  const { signalKey, spec, signalType, possibleValues, reading } = opts
  if (!reading || reading.legible === false) return null

  const transcribed = typeof reading.transcribed === 'string' ? clip(reading.transcribed) : ''
  const where = `Read from ${spec.readFrom}${reading.photo ? ` (photo ${reading.photo})` : ''}`

  const accept = (raw: string | number): string | number | null => {
    if (signalType === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
      return Number.isFinite(n) && n > 0 ? n : null
    }
    if (signalType === 'boolean') return null // identification is for what the equipment IS
    return matchPossibleValue(raw, possibleValues)
  }

  if (transcribed && spec.decode && spec.decode.length > 0) {
    const decoded = decodeTranscription(transcribed, spec.decode)
    const value = decoded ? accept(decoded.value) : null
    if (decoded && value !== null) {
      return {
        signalKey,
        value,
        method: 'decoded',
        confidence: IDENTIFICATION_DECODED_CONFIDENCE,
        evidence: `${where}: "${transcribed}" → ${value}${decoded.rule.label ? ` (${decoded.rule.label})` : ''}`,
        transcribed,
      }
    }
  }

  if (reading.value !== undefined && reading.value !== null && String(reading.value).trim() !== '') {
    const value = accept(reading.value)
    if (value !== null) {
      return {
        signalKey,
        value,
        method: 'read',
        confidence: IDENTIFICATION_READ_CONFIDENCE,
        evidence: transcribed ? `${where}: "${transcribed}" → ${value}` : `${where}: ${value}`,
        ...(transcribed && { transcribed }),
      }
    }
  }
  return null
}
