/**
 * Normalize a widget field option to {value, label}.
 * Options nominally arrive as strings, but the AI pricing compiler sometimes
 * emits {label, value} objects — both shapes must save without a 500.
 */
export function normalizeFieldOption(
  opt: string | { value?: string; label?: string }
): { value: string; label: string } {
  if (typeof opt === 'object' && opt !== null) {
    const label = opt.label ?? String(opt.value ?? '')
    const value = opt.value ?? label.toLowerCase().replace(/\s+/g, '_')
    return { value, label }
  }
  const s = String(opt)
  return { value: s.toLowerCase().replace(/\s+/g, '_'), label: s }
}
