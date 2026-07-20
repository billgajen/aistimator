/**
 * Deterministic quantity formulas (T-125, Measurement/Pricing).
 *
 * A tiny, safe expression language for derived work-step quantities:
 *   ceil(max(0, num_transactions - 1000) / 500)
 *   max(0, total_distance_miles - 25)
 *   ceil((adult_guests + child_guests) / 15)
 *
 * Grammar: numbers, identifiers (form fieldIds / signal keys), + - * /,
 * parentheses, and the functions ceil, floor, round, min, max, abs.
 * No eval, no property access, no strings — parsing anything else fails.
 * AD-001 holds: formulas are config, authored at compile time and reviewable;
 * evaluation is pure arithmetic over customer answers / extracted signals.
 */

export const FORMULA_MAX_LENGTH = 300
const MAX_TOKENS = 120

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  ceil: (a) => Math.ceil(a[0] ?? NaN),
  floor: (a) => Math.floor(a[0] ?? NaN),
  round: (a) => Math.round(a[0] ?? NaN),
  abs: (a) => Math.abs(a[0] ?? NaN),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
}
const FUNCTION_ARITY: Record<string, { min: number; max: number }> = {
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 1, max: 8 },
  max: { min: 1, max: 8 },
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '(' | ')' | ',' }

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

function tokenize(formula: string): Token[] | { error: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < formula.length) {
    const c = formula.charAt(i)
    if (/\s/.test(c)) { i++; continue }
    if ('+-*/(),'.includes(c)) {
      tokens.push({ kind: 'op', op: c as '+' | '-' | '*' | '/' | '(' | ')' | ',' })
      i++
    } else if (/[0-9.]/.test(c)) {
      const text = formula.slice(i).match(/^\d*\.?\d+/)?.[0]
      if (text === undefined) return { error: `Invalid number at position ${i}` }
      tokens.push({ kind: 'num', value: Number(text) })
      i += text.length
    } else if (/[a-zA-Z_]/.test(c)) {
      const text = formula.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/)?.[0]
      if (text === undefined) return { error: `Invalid identifier at position ${i}` }
      tokens.push({ kind: 'ident', name: text })
      i += text.length
    } else {
      return { error: `Unexpected character "${c}" at position ${i}` }
    }
    if (tokens.length > MAX_TOKENS) return { error: 'Formula too complex' }
  }
  if (tokens.length === 0) return { error: 'Empty formula' }
  return tokens
}

/**
 * Evaluate a formula. `resolve` maps an identifier (form fieldId or signal
 * key) to a number, or undefined when unknown — unknown identifiers fail the
 * whole evaluation so the caller can fall back explicitly rather than price
 * on garbage.
 */
export function evaluateFormula(
  formula: string,
  resolve: (name: string) => number | undefined
): FormulaResult {
  if (typeof formula !== 'string' || formula.length > FORMULA_MAX_LENGTH) {
    return { ok: false, error: 'Formula missing or too long' }
  }
  const tokenized = tokenize(formula)
  if ('error' in tokenized) return { ok: false, error: tokenized.error }
  const toks: Token[] = tokenized

  let pos = 0
  const peekOp = (): string | null => {
    const t = toks[pos]
    return t !== undefined && t.kind === 'op' ? t.op : null
  }
  function failParse(msg: string): never { throw new Error(msg) }

  function parseExpr(): number {
    let left = parseTerm()
    while (peekOp() === '+' || peekOp() === '-') {
      const op = peekOp()
      pos++
      const right = parseTerm()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  function parseTerm(): number {
    let left = parseUnary()
    while (peekOp() === '*' || peekOp() === '/') {
      const op = peekOp()
      pos++
      const right = parseUnary()
      if (op === '/') {
        if (right === 0) failParse('Division by zero')
        left = left / right
      } else {
        left = left * right
      }
    }
    return left
  }

  function parseUnary(): number {
    if (peekOp() === '-') {
      pos++
      return -parseUnary()
    }
    return parsePrimary()
  }

  function parsePrimary(): number {
    const t = toks[pos]
    if (t === undefined) failParse('Unexpected end of formula')
    pos++
    if (t.kind === 'num') return t.value
    if (t.kind === 'ident') {
      // Function call?
      if (peekOp() === '(') {
        const fn = FUNCTIONS[t.name]
        const arity = FUNCTION_ARITY[t.name]
        if (!fn || !arity) failParse(`Unknown function "${t.name}"`)
        pos++ // consume (
        const args: number[] = [parseExpr()]
        while (peekOp() === ',') {
          pos++
          args.push(parseExpr())
        }
        if (peekOp() !== ')') failParse(`Missing ) after ${t.name}(...)`)
        pos++
        if (args.length < arity.min || args.length > arity.max) failParse(`${t.name}() takes ${arity.min}–${arity.max} arguments`)
        return fn(args)
      }
      const value = resolve(t.name)
      if (value === undefined || !Number.isFinite(value)) failParse(`Unknown value "${t.name}"`)
      return value
    }
    if (t.op === '(') {
      const v = parseExpr()
      if (peekOp() !== ')') failParse('Missing closing )')
      pos++
      return v
    }
    failParse(`Unexpected "${t.op}"`)
  }

  try {
    const value = parseExpr()
    if (pos !== toks.length) return { ok: false, error: 'Unexpected trailing input' }
    if (!Number.isFinite(value)) return { ok: false, error: 'Formula did not produce a finite number' }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Identifiers referenced by a formula (for compile-time validation that each
 * maps to a real form field or expected signal). Returns null if unparsable.
 */
export function extractFormulaIdentifiers(formula: string): string[] | null {
  if (typeof formula !== 'string' || formula.length > FORMULA_MAX_LENGTH) return null
  const tokens = tokenize(formula)
  if ('error' in tokens) return null
  const idents = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === undefined || t.kind !== 'ident') continue
    const next = tokens[i + 1]
    const isFunctionCall = next !== undefined && next.kind === 'op' && next.op === '('
    if (!isFunctionCall) idents.add(t.name)
    else if (!FUNCTIONS[t.name]) return null
  }
  // Syntax check: evaluate with a dummy resolver. Only structural errors are
  // fatal — value-dependent ones (division by zero on dummy inputs) are not.
  const probe = evaluateFormula(formula, () => 1)
  if (!probe.ok && !/Division by zero|Unknown value/.test(probe.error)) return null
  return [...idents]
}
