import { useCallback, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { formatMoney, type QuoteListItem } from '@qolumns/shared'
import { useApi } from '../src/lib/api-context'
import { toApiError, type AccountNotice } from '../src/lib/api'
import { useOutbox, useOutboxState } from '../src/lib/outbox-context'
import { draftProgress, draftTitle, OUTBOX_COPY, type Draft } from '../src/lib/outbox'
import { TONE_STYLE, turnOfListItem } from '../src/lib/status'
import { supabase } from '../src/lib/supabase'
import { BottomBar, Button, ErrorText, Muted, Notice, Pill, ProgressBar, Screen } from '../src/components/ui'
import { colors, radius, space, touch, type } from '../src/theme'

export default function Quotes() {
  const api = useApi()
  const router = useRouter()
  const outbox = useOutbox()
  useOutboxState() // redraw when a draft moves
  const [items, setItems] = useState<QuoteListItem[]>([])
  const [notice, setNotice] = useState<AccountNotice | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems((await api.listQuotes('all')).items)
    } catch (e) {
      const failure = toApiError(e)
      // the quotes already on the screen stay; only the reason is said
      setError(failure.offline ? 'No signal. This list may be out of date.' : failure.message)
    } finally {
      setLoading(false)
    }
    // the account line is a courtesy: the list never waits on it
    api.accountNotice().then(setNotice, () => undefined)
  }, [api])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const drafts = outbox.mine()
  const waiting = drafts.filter((d) => d.send !== 'editing')
  const unfinished = drafts.find((d) => d.send === 'editing' && (d.serviceId || d.photos.length > 0)) ?? null

  function signOut() {
    if (drafts.length === 0) {
      void supabase.auth.signOut()
      return
    }
    Alert.alert('Sign out?', 'A quote on this phone has not been sent yet. It stays saved and is sent when you sign in again.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void supabase.auth.signOut() },
    ])
  }

  return (
    <Screen>
      <FlatList
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        data={items}
        keyExtractor={(q) => q.quoteId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        ListHeaderComponent={
          <View>
            {notice ? <Notice tone={notice.kind === 'suspended' ? 'danger' : 'notice'}>{notice.line}</Notice> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            {waiting.map((draft) => (
              <WaitingRow key={draft.id} draft={draft} onPress={() => router.push(`/new?draft=${draft.id}`)} />
            ))}
            {unfinished ? (
              <Pressable accessibilityRole="button" onPress={() => router.push('/new')} style={styles.draftRow}>
                <Text style={styles.name}>Unfinished quote</Text>
                <Muted>{draftTitle(unfinished)} · saved on this phone. Tap to carry on.</Muted>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={loading || error ? undefined : <Muted>No quotes yet. Your first one takes a couple of minutes.</Muted>}
        renderItem={({ item }) => <QuoteRow item={item} onPress={() => router.push(`/quote/${item.quoteId}`)} />}
        ListFooterComponent={
          <View style={{ marginTop: space.xl }}>
            <Button title="Sign out" variant="quiet" onPress={signOut} />
          </View>
        }
      />
      <BottomBar>
        <Button title={unfinished ? 'Carry on with the quote' : 'New quote'} onPress={() => router.push('/new')} />
      </BottomBar>
    </Screen>
  )
}

function QuoteRow({ item, onPress }: { item: QuoteListItem; onPress: () => void }) {
  const turn = turnOfListItem(item)
  const showTotal = item.total > 0 && !item.held && item.status !== 'failed'
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.mint }]}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={styles.name}>{item.customerName || 'Customer'}</Text>
        <Text style={styles.service}>{item.serviceName}</Text>
        <Pill label={turn.label} tone={TONE_STYLE[turn.tone]} />
        {turn.detail ? <Muted>{turn.detail}</Muted> : null}
      </View>
      {showTotal ? <Text style={styles.total}>{formatMoney(item.total, item.currency)}</Text> : null}
    </Pressable>
  )
}

/** A quote that has not reached the server yet: it is on this phone and sends by itself */
function WaitingRow({ draft, onPress }: { draft: Draft; onPress: () => void }) {
  const progress = draftProgress(draft)
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.draftRow}>
      <Text style={styles.name}>{draftTitle(draft)}</Text>
      <Muted>{draft.problem ? draft.problem.message : draft.send === 'sending' ? 'Sending the job' : progress.line || OUTBOX_COPY.offline}</Muted>
      <View style={{ marginTop: space.sm }}>
        <ProgressBar fraction={progress.fraction} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  draftRow: {
    minHeight: touch.row,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  name: { color: colors.ink, fontWeight: '700', fontSize: type.large },
  service: { color: colors.textSecondary, fontSize: type.body },
  total: { color: colors.ink, fontVariant: ['tabular-nums'], fontWeight: '700', fontSize: type.large },
})
