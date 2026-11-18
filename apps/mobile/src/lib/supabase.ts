/**
 * Supabase auth on the device: the session lives in the OS keychain
 * (expo-secure-store), never in plain storage. It is stored in parts
 * (chunked-store.ts): a session is longer than the keychain likes.
 */

import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import { chunkedStore } from './chunked-store'
import { config, configProblem } from './config'

const secureStorage = chunkedStore({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
})

// With a setting missing the app shows its set-up screen and never signs in;
// the client is still made (with a stand-in address) so nothing crashes on import.
export const supabase = createClient(config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'not-set', {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Keep the sign-in fresh only while the app is in front (Supabase's rule for React Native)
if (configProblem.length === 0) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh()
    else void supabase.auth.stopAutoRefresh()
  })
}

// Who is signed in, kept up to date for the sending queue (a draft belongs to the sign-in that wrote it)
let userId: string | null = null
void supabase.auth.getSession().then(({ data }) => {
  userId = data.session?.user.id ?? userId
})
supabase.auth.onAuthStateChange((_event, session) => {
  userId = session?.user.id ?? null
})
export const currentUserId = (): string | null => userId

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
