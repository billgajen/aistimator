/**
 * Build-time configuration (EXPO_PUBLIC_* env vars are inlined by Expo).
 * No secrets: the Supabase anon key is public by design (RLS protects data).
 */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see apps/mobile/.env.example)`)
  return value
}

export const config = {
  apiUrl: required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
}
