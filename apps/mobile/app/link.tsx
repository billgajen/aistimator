/**
 * T-184: the business's own quote link as a QR code, large, to hold up to a
 * customer on site (T-149). They point their camera at it and get the
 * business's request page. The link is shown in words too, and can be sent
 * or copied.
 */
import { useEffect, useState } from 'react'
import { Dimensions, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { AppAccountResponse } from '@qolumns/shared'
import { useApi } from '../src/lib/api-context'
import { shortLink } from '../src/lib/account'
import { plainError } from '../src/lib/errors'
import { done } from '../src/lib/feel'
import { Qr } from '../src/components/Qr'
import { BottomBar, Button, ErrorText, Muted, Screen, Skeleton } from '../src/components/ui'
import { colors, fonts, radius, scale, space, type } from '../src/theme'

export default function QuoteLink() {
  const api = useApi()
  const [account, setAccount] = useState<AppAccountResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    api.account().then(
      (a) => alive && setAccount(a),
      (e) => alive && setError(plainError(e, 'Your quote link could not be loaded. Try again.'))
    )
    return () => {
      alive = false
    }
  }, [api])

  const link = account?.quoteLink ?? null
  const side = Math.min(Dimensions.get('window').width - space.xl * 2, 340)

  async function copy() {
    if (!link) return
    await Clipboard.setStringAsync(link).catch(() => undefined)
    done()
    setCopied(true)
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!account && !error ? <Skeleton width={side} height={side} style={{ borderRadius: radius.lg }} /> : null}
        {account && !link ? <Muted>Your business has no quote link yet. Set one in your dashboard, under Quote link.</Muted> : null}
        {account && link ? (
          <>
            <Text accessibilityRole="header" style={styles.name} maxFontSizeMultiplier={scale.large}>
              {account.businessName}
            </Text>
            <Text style={styles.ask} maxFontSizeMultiplier={scale.text}>
              Point your phone’s camera at the code to ask for a quote.
            </Text>
            <View style={styles.code}>
              <Qr value={link} size={side} label={`QR code for ${shortLink(link)}`} />
            </View>
            <Text style={styles.link} selectable maxFontSizeMultiplier={scale.large}>
              {shortLink(link)}
            </Text>
            {copied ? (
              <Text accessibilityRole="alert" style={styles.copied} maxFontSizeMultiplier={scale.text}>
                Link copied.
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {link ? (
        <BottomBar>
          <Button title="Send the link" icon="share-outline" onPress={() => void Share.share({ message: link }).catch(() => undefined)} />
          <Button title="Copy link" icon="copy-outline" variant="secondary" onPress={() => void copy()} />
        </BottomBar>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', padding: space.xl, gap: space.md },
  name: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, textAlign: 'center' },
  ask: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body, lineHeight: 23, textAlign: 'center' },
  // a white card with room round the code: scanners need the quiet edge
  code: { backgroundColor: '#FFFFFF', padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  link: { color: colors.ink, fontFamily: fonts.figure, fontSize: type.body, textAlign: 'center' },
  copied: { color: colors.secondary, fontFamily: fonts.semi, fontSize: type.body },
})
