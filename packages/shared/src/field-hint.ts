/**
 * T-196: a question's hint is shown once, under its box.
 *
 * Until T-196 a service's questions were saved with the hint copied into the
 * box as well (`placeholder`), where it was cut off, and shown again under
 * it. New questions are saved without the copy; this is for the ones already
 * saved: what goes inside the box is the question's own short example, or
 * nothing when it only repeats the hint.
 */
export function fieldExample(field: { placeholder?: string | null; helpText?: string | null }): string | undefined {
  const example = (field.placeholder ?? '').trim()
  if (!example) return undefined
  return example === (field.helpText ?? '').trim() ? undefined : example
}
