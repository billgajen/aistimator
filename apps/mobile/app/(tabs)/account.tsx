/**
 * The Account tab (T-184): whose app this is, how much of the plan is used,
 * the quote link to show a customer, (T-196) the three notification
 * switches, help, sign out, and (T-191) delete your account.
 *
 * Nothing here is a price or a way to buy: an app may not point at a
 * purchase outside it. The plan is named and its use is counted, no more.
 */
import { useCallback, useState } from 'react'
import { Alert, Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { ADDRESS_COPY, PRODUCT_NAME, PUSH_COPY, SUPPORT_EMAIL, type AppAccountResponse } from '@qolumns/shared'
import { useApi } from '../../src/lib/api-context'
import { deleteAccountUrl, planLine, shortLink, usageFraction, usageLine } from '../../src/lib/account'
import { config } from '../../src/lib/config'
import { rememberLink } from '../../src/lib/link-memory'
import { currentUserId } from '../../src/lib/supabase'
import { toApiError } from '../../src/lib/api'
import { plainError } from '../../src/lib/errors'
import { useOutbox, useOutboxState } from '../../src/lib/outbox-context'
import { usePush } from '../../src/lib/push-context'
import { PUSH_SWITCHES } from '../../src/lib/push'
import { Card, ErrorText, Label, LinkRow, Muted, ProgressBar, Screen, Skeleton, SwitchRow, TopBar } from '../../src/components/ui'
import { colors, fonts, radius, scale, space, tabular, type } from '../../src/theme'

export default function Account() {
  const api = useApi()
  const router = useRouter()
  const outbox = useOutbox()
  useOutboxState()
  const push = usePush()
  const [account, setAccount] = useState<AppAccountResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)

  const load = useCallback(
    async (pulled = false) => {
      if (pulled) setRefreshing(true)
      setError(null)
      try {
        const read = await api.account()
        setAccount(read)
        setLogoFailed(false)
        // T-204: "Show the QR code" draws at once from this, with no second read
        void rememberLink(currentUserId(), read)
      } catch (e) {
        setError(toApiError(e).offline ? 'No signal. This may be out of date.' : plainError(e, 'Your account could not be loaded. Pull down to try again.'))
      } finally {
        setRefreshing(false)
      }
    },
    [api]
  )

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const drafts = outbox.mine()
  function signOut() {
    if (drafts.length === 0) {
      Alert.alert('Sign out?', undefined, [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void push.signOut() },
      ])
      return
    }
    Alert.alert('Sign out?', 'A quote on this phone has not been sent yet. It stays saved and is sent when you sign in again.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void push.signOut() },
    ])
  }

  // T-196: a switch that could not be saved goes back, and says so
  async function setSwitch(key: (typeof PUSH_SWITCHES)[number], value: boolean) {
    if (!(await push.setPref(key, value))) setError(PUSH_COPY.saveFailed)
  }
  const notifications = push.section

  const fraction = account ? usageFraction(account) : null
  const version = Constants.expoConfig?.version ?? ''
  const supportEmail = account?.supportEmail ?? SUPPORT_EMAIL

  return (
    <Screen>
      <TopBar title="Account" />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* 1. Whose app this is */}
        <Card>
          {account ? (
            <View style={styles.identity} accessible accessibilityLabel={account.businessName}>
              {account.logoUrl && !logoFailed ? (
                // the name is beside it, so the picture needs no words of its own
                <Image source={{ uri: account.logoUrl }} style={styles.logo} resizeMode="contain" onError={() => setLogoFailed(true)} accessibilityIgnoresInvertColors />
              ) : (
                <View style={[styles.logo, styles.initial]}>
                  <Text style={styles.initialText} maxFontSizeMultiplier={scale.large}>
                    {(account.businessName.trim()[0] ?? '').toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.name} maxFontSizeMultiplier={scale.large}>
                {account.businessName}
              </Text>
            </View>
          ) : (
            <View style={styles.identity} accessible accessibilityLabel="Loading your account">
              <Skeleton width={56} height={56} style={{ borderRadius: radius.md }} />
              <Skeleton width="55%" height={22} />
            </View>
          )}
        </Card>

        {/* 2. The plan and how much of it is used. No prices, no way to buy. */}
        <Card>
          <Label>Your plan</Label>
          {account ? (
            <>
              <Text style={styles.plan} maxFontSizeMultiplier={scale.large}>
                {planLine(account)}
              </Text>
              <Text style={styles.usage} maxFontSizeMultiplier={scale.text}>
                {usageLine(account)}
              </Text>
              {fraction !== null ? (
                <View style={{ marginTop: space.sm }}>
                  <ProgressBar fraction={fraction} label={usageLine(account)} />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Skeleton width="30%" height={22} />
              <Skeleton width="70%" height={16} style={{ marginTop: space.md }} />
            </>
          )}
        </Card>

        {/* 3. The quote link, to show a customer on site */}
        <Card>
          <Label>Your quote link</Label>
          {account?.quoteLink ? <Muted style={{ marginTop: 0, marginBottom: space.sm }}>{shortLink(account.quoteLink)}</Muted> : null}
          {/* T-199: when the business's own address is its main link, its quote link still works */}
          {account?.alsoLink ? <Muted style={{ marginTop: 0, marginBottom: space.sm }}>{`${ADDRESS_COPY.alsoWorks}: ${shortLink(account.alsoLink)}`}</Muted> : null}
          <LinkRow
            title="Show the QR code"
            note="A customer points their camera at it to ask for a quote"
            icon="qr-code-outline"
            onPress={() => router.push('/link')}
            last
          />
        </Card>

        {/* 4. T-196: the three notifications, each with its switch. A build that cannot receive them says so. */}
        <Card>
          <Label>{PUSH_COPY.section}</Label>
          {notifications.kind === 'unavailable' ? (
            <Muted style={{ marginTop: 0 }}>{notifications.line}</Muted>
          ) : notifications.kind === 'ask' ? (
            <LinkRow title={PUSH_COPY.askTitle} note={PUSH_COPY.ask} icon="notifications-outline" onPress={() => void push.turnOn()} last />
          ) : (
            <>
              {notifications.kind === 'refused' ? <Muted style={{ marginTop: 0, marginBottom: space.sm }}>{notifications.line}</Muted> : null}
              {PUSH_SWITCHES.map((key, i) => (
                <SwitchRow
                  key={key}
                  title={PUSH_COPY.switches[key].title}
                  note={PUSH_COPY.switches[key].note}
                  value={notifications.prefs[key]}
                  disabled={notifications.kind === 'refused'}
                  onChange={(value) => void setSwitch(key, value)}
                  last={notifications.kind !== 'refused' && i === PUSH_SWITCHES.length - 1}
                />
              ))}
              {notifications.kind === 'refused' ? (
                <LinkRow title={PUSH_COPY.openSettings} icon="settings-outline" onPress={() => void Linking.openSettings().catch(() => undefined)} last />
              ) : null}
            </>
          )}
        </Card>

        {/* 5. Help, the version, signing out */}
        <Card>
          <LinkRow
            title="Help"
            note={`Email ${supportEmail}`}
            icon="help-circle-outline"
            onPress={() => void Linking.openURL(`mailto:${supportEmail}?subject=${encodeURIComponent(`${PRODUCT_NAME} app`)}`).catch(() => setError(`Write to ${supportEmail} from your email.`))}
          />
          <LinkRow title="Sign out" icon="log-out-outline" onPress={signOut} />
          {/* T-191: Apple asks for a clear way to delete the account; it is closed on the web (data deletion page) */}
          <LinkRow
            title="Delete your account"
            note="Opens the steps on the web"
            icon="trash-outline"
            danger
            onPress={() => void Linking.openURL(deleteAccountUrl(config.apiUrl)).catch(() => setError(`Write to ${supportEmail} to close your account.`))}
            last
          />
        </Card>

        <Text style={styles.version} maxFontSizeMultiplier={scale.large}>
          {PRODUCT_NAME} app{version ? ` ${version}` : ''}
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface },
  initial: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint },
  initialText: { color: colors.brand, fontFamily: fonts.display, fontSize: type.title },
  name: { flex: 1, color: colors.ink, fontFamily: fonts.display, fontSize: type.title, letterSpacing: -0.3 },
  plan: { color: colors.ink, fontFamily: fonts.displayBold, fontSize: type.large },
  usage: { color: colors.textSecondary, fontFamily: fonts.figure, fontVariant: tabular, fontSize: type.body, marginTop: space.xs },
  version: { color: colors.muted, fontFamily: fonts.figure, fontVariant: tabular, fontSize: type.note, textAlign: 'center', marginTop: space.md },
})
