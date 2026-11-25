/**
 * T-184: the business's own quote link as a QR code, large, to hold up to a
 * customer on site (T-149). They point their camera at it and get the
 * business's request page. The link is shown in words too, and can be sent
 * or copied.
 *
 * T-204: the code is drawn at once from the link the phone already holds
 * (lib/link-memory.ts): the Account tab this screen is opened from has just
 * read it, and it is saved on the phone for the next time. The server is
 * still asked, quietly; the code is drawn again only if the link has changed.
 * With nothing held (the first open on a new phone) it waits for the server,
 * as it used to.
 */
import { useEffect, useState } from 'react'
import { Dimensions, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useApi } from '../src/lib/api-context'
import { shortLink } from '../src/lib/account'
import { linkInMemory, loadSavedLink, rememberLink, type SavedLink } from '../src/lib/link-memory'
import { currentUserId } from '../src/lib/supabase'
import { plainError } from '../src/lib/errors'
import { done } from '../src/lib/feel'
import { Qr } from '../src/components/Qr'
import { BottomBar, Button, ErrorText, Muted, Screen, Skeleton } from '../src/components/ui'
import { colors, fonts, radius, scale, space, type } from '../src/theme'

export default function QuoteLink() {
  const api = useApi()
  // What the phone holds is there in the first frame: no grey square, no wait
  const [account, setAccount] = useState<Pick<SavedLink, 'businessName' | 'quoteLink'> | null>(() => linkInMemory(currentUserId()))
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    let shown = linkInMemory(currentUserId()) !== null
    const userId = currentUserId()
    // 1. saved on the phone from an earlier run (a few milliseconds, no network)
    if (!shown) {
      void loadSavedLink(userId).then((saved) => {
        if (alive && saved && !shown) {
          shown = true
          setError(null)
          setAccount(saved)
        }
      })
    }
    // 2. the server, quietly: it corrects a link that has changed, and fills a phone that holds none
    api.account().then(
      (a) => {
        void rememberLink(userId, a)
        if (!alive) return
        shown = true
        setError(null)
        setAccount((now) => (now && now.quoteLink === a.quoteLink && now.businessName === a.businessName ? now : a))
      },
      // with a code already on screen a failed read says nothing: the code still works
      (e) => alive && !shown && setError(plainError(e, 'Your quote link could not be loaded. Try again.'))
    )
    return () => {
      alive = false
    }
  }, [api])

  const link = account?.quoteLink ?? null
  const side = Math.min(Dimensions.get('window').width - space.xl * 2, 340)

  // T-202: pressing Copy or Send ticks "Share your quote link" on Home. Best-effort: with no
  // signal the link is still copied or sent, and the tick comes with the next press.
  const noteShared = (event: 'copied' | 'shared') => void api.quoteLinkShared(event).catch(() => undefined)

  async function copy() {
    if (!link) return
    noteShared('copied')
    await Clipboard.setStringAsync(link).catch(() => undefined)
    done()
    setCopied(true)
  }

  function send() {
    if (!link) return
    noteShared('shared')
    void Share.share({ message: link }).catch(() => undefined)
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
          <Button title="Send the link" icon="share-outline" onPress={send} />
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
  link: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, textAlign: 'center' },
  copied: { color: colors.secondary, fontFamily: fonts.semi, fontSize: type.body },
})
