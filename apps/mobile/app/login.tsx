import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { PRODUCT_NAME } from '@qolumns/shared'
import { supabase } from '../src/lib/supabase'
import { Button, ErrorText, Field, Muted, Screen } from '../src/components/ui'
import { colors, fonts, scale, space } from '../src/theme'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) {
        // no status means no answer came back: that is the signal, not the password. The sign-in service's
        // own wording is never shown: a plain sentence is.
        setError(
          !authError.status
            ? 'No signal. Check your connection and try again.'
            : authError.status === 429
              ? 'Too many tries. Wait a minute, then try again.'
              : authError.status >= 500
                ? 'Sign-in is not answering just now. Try again in a minute.'
                : 'That email or password is not right.'
        )
      }
    } catch {
      setError('No signal. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.brand} maxFontSizeMultiplier={scale.large}>
          {PRODUCT_NAME}
        </Text>
        <Muted>Quote on site. Sign in with the email and password you use on the web.</Muted>
        <View style={{ height: space.xl }} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={signIn} returnKeyType="go" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button title="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />
        <Muted style={{ marginTop: space.lg }}>Forgotten your password? Reset it on the web sign-in page, then sign in here.</Muted>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: space.xl },
  // the wordmark: the product's name in the display face (the logo file comes later)
  brand: { fontFamily: fonts.display, fontSize: 40, letterSpacing: -1, color: colors.brand, marginBottom: space.xs },
})
