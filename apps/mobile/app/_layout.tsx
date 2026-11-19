import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque'
import { InstrumentSans_400Regular, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans'
import type { Session } from '@supabase/supabase-js'
import { PRODUCT_NAME } from '@qolumns/shared'
import { supabase } from '../src/lib/supabase'
import { ApiProvider } from '../src/lib/api-context'
import { OutboxProvider } from '../src/lib/outbox-context'
import { configProblem } from '../src/lib/config'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { colors, fonts, space, tabular, type } from '../src/theme'

// The splash stays until the brand faces are ready, so the first screen is never drawn in the wrong face
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

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
            headerTitleStyle: { color: colors.ink, fontFamily: fonts.displayBold },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.paper },
          }}
        >
          {/* The three tabs draw their own tops (no navigation header to sit over them) */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
          {/* no slide when a job that was just sent becomes its quote: it reads as one screen */}
          <Stack.Screen name="quote/[id]" options={{ title: 'Quote' }} />
          <Stack.Screen name="photo" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="link" options={{ title: 'Your quote link', presentation: 'modal' }} />
        </Stack>
      </OutboxProvider>
    </ApiProvider>
  )
}

export default function RootLayout() {
  const [loaded, failed] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  })
  // A face that cannot be loaded must not keep the app shut: the phone's own font is used instead
  const ready = loaded || Boolean(failed)
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined)
  }, [ready])
  if (!ready) return null

  return (
    <ErrorBoundary>
      <StatusBar style="dark" />
      {configProblem.length > 0 ? <SetUp /> : <SignedInArea />}
    </ErrorBoundary>
  )
}

const styles = StyleSheet.create({
  setUp: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.paper },
  setUpTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, marginBottom: space.md },
  setUpText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, marginVertical: space.sm },
  setUpName: { color: colors.ink, fontFamily: fonts.figure, fontVariant: tabular, fontSize: type.body, marginVertical: 2 },
})
