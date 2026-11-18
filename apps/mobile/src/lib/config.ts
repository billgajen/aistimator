/**
 * Build-time configuration (EXPO_PUBLIC_* env vars are inlined by Expo).
 * No secrets: the Supabase anon key is public by design (RLS protects data).
 *
 * A missing value is not thrown at import: that is a red crash screen on the
 * phone. The app shows one plain screen naming what is missing (app/_layout).
 */

const values = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
}

/** The names of the settings that are not set (never a value) */
export function missingSettings(env: Record<string, string | undefined> = values): string[] {
  return Object.entries(env)
    .filter(([, value]) => !value || !value.trim())
    .map(([name]) => name)
}

export const configProblem: string[] = missingSettings()

export const config = {
  apiUrl: (values.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, ''),
  supabaseUrl: (values.EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (values.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
}
