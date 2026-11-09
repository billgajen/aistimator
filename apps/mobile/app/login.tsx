import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
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
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) setError(authError.message)
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <Text style={styles.brand}>Aistimator</Text>
        <Muted>Quote on site. Sign in with your business account.</Muted>
        <View style={{ height: space.xl }} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button title="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: space.xl },
  brand: { fontSize: 32, fontWeight: '800', color: colors.brand, marginBottom: space.xs },
})
