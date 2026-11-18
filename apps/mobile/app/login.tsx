import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { PRODUCT_NAME } from '@qolumns/shared'
import { supabase } from '../src/lib/supabase'
import { Button, ErrorText, Field, Muted, Screen } from '../src/components/ui'
import { colors, space } from '../src/theme'

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
        // no status means no answer came back: that is the signal, not the password
        setError(authError.status ? authError.message : 'No signal. Check your connection and try again.')
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
        <Text accessibilityRole="header" style={styles.brand}>
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
  brand: { fontSize: 36, fontWeight: '800', color: colors.brand, marginBottom: space.xs },
})
