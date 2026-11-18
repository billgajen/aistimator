import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { Session } from '@supabase/supabase-js'
import { PRODUCT_NAME } from '@qolumns/shared'
import { supabase } from '../src/lib/supabase'
import { ApiProvider } from '../src/lib/api-context'
import { OutboxProvider } from '../src/lib/outbox-context'
import { configProblem } from '../src/lib/config'
import { colors, space, type } from '../src/theme'

/** A setting is missing: say which, by name, instead of crashing (see apps/mobile/.env.example) */
function SetUp() {
  return (
    <View style={styles.setUp}>
      <Text style={styles.setUpTitle}>{PRODUCT_NAME} is not set up yet</Text>
      <Text style={styles.setUpText}>These settings are missing from apps/mobile/.env:</Text>
      {configProblem.map((name) => (
        <Text key={name} style={styles.setUpName}>
          {name}
        </Text>
      ))}
      <Text style={styles.setUpText}>Add them, then stop and start “npx expo start” again.</Text>
    </View>
  )
}

function SignedInArea() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // Signed out → login; signed in on the login screen → quotes
  useEffect(() => {
    if (session === undefined) return
    const onLogin = segments[0] === 'login'
    if (!session && !onLogin) router.replace('/login')
    else if (session && onLogin) router.replace('/')
  }, [session, segments, router])

  return (
    <ApiProvider>
      <OutboxProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.brand,
            headerTitleStyle: { color: colors.ink },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.paper },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Quotes' }} />
          <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
          <Stack.Screen name="new" options={{ title: 'New quote' }} />
          <Stack.Screen name="quote/[id]" options={{ title: 'Quote' }} />
        </Stack>
      </OutboxProvider>
    </ApiProvider>
  )
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      {configProblem.length > 0 ? <SetUp /> : <SignedInArea />}
    </>
  )
}

const styles = StyleSheet.create({
  setUp: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.paper },
  setUpTitle: { color: colors.ink, fontSize: type.title, fontWeight: '800', marginBottom: space.md },
  setUpText: { color: colors.textSecondary, fontSize: type.body, lineHeight: 22, marginVertical: space.sm },
  setUpName: { color: colors.ink, fontSize: type.body, fontWeight: '600', fontVariant: ['tabular-nums'], marginVertical: 2 },
})
