import { useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { PRODUCT_NAME } from '@qolumns/shared'
import { supabase } from '../src/lib/supabase'
import { Button, ErrorText, Field, Muted, Screen } from '../src/components/ui'
import { space } from '../src/theme'
import { WORDMARK_SIZE } from '../src/lib/wordmark'
import WORDMARK from '../assets/wordmark.png'

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
        <Image source={WORDMARK} style={styles.brand} accessible accessibilityRole="header" accessibilityLabel={PRODUCT_NAME} resizeMode="contain" />
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
  // T-190: the owner's wordmark (brand/qolumns-wordmark.png, 3x of its shown size); width and height fixed so nothing moves
  brand: { width: WORDMARK_SIZE.width, height: WORDMARK_SIZE.height, marginBottom: space.md },
})
