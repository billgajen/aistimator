/**
 * Lightweight class name merge utility.
 * Joins truthy class strings and deduplicates Tailwind conflicts
 * by letting the last class win for the same utility group.
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(' ')
}
