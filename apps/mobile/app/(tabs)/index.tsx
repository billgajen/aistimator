/**
 * The Quotes tab (T-184): what needs me now.
 *
 * Grouped as the dashboard's Home is, in the same words (shared
 * quote-turn.ts): "Needs you" first with its count, then "Waiting for
 * customer", "Accepted", then the rest. A request that could not be priced,
 * or one saved at the plan limit, is in "Needs you" with its reason. Quotes
 * still on this device (unfinished, or waiting for a signal) sit above them
 * all. Search by customer name; pull down to refresh.
 */
import { accountNoticeLine } from '../../src/lib/onsite-gate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import type { AppWonLines, QuoteListItem } from '@qolumns/shared'
import { useApi } from '../../src/lib/api-context'
import { toApiError, type AccountNotice } from '../../src/lib/api'
import { plainError } from '../../src/lib/errors'
import { deviceWord, forDevice } from '../../src/lib/device'
import { useOutbox, useOutboxState } from '../../src/lib/outbox-context'
import { usePush } from '../../src/lib/push-context'
import { draftProgress, draftTitle, OUTBOX_COPY, type Draft } from '../../src/lib/outbox'
import { groupQuotes, matchesSearch, rowWords, type ListGroup } from '../../src/lib/quote-list'
import { TONE_STYLE, turnOfListItem } from '../../src/lib/status'
import { Button, EmptyState, ErrorText, Icon, Muted, Notice, Pill, ProgressBar, Screen, Skeleton, TopBar } from '../../src/components/ui'
import { colors, fonts, icon, radius, scale, space, tabular, touch, type } from '../../src/theme'

/** T-206: what the quotes kept here are said to be on: an iPad on an iPad, a phone everywhere else */
const DEVICE = deviceWord(Platform.OS, Platform.OS === 'ios' && Platform.isPad)

export default function Quotes() {
  const api = useApi()
  const router = useRouter()
  const outbox = useOutbox()
  useOutboxState() // redraw when a draft moves
  const [items, setItems] = useState<QuoteListItem[] | null>(null)
  const [notice, setNotice] = useState<AccountNotice | null>(null)
  // T-196: "Won this month", as the dashboard's Home says it; nothing before the first accepted estimate
  const [won, setWon] = useState<AppWonLines | null>(null)
  const push = usePush()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const asked = useRef(0)

  const load = useCallback(
    async (text: string, pulled = false) => {
      const mine = ++asked.current
      if (pulled) setRefreshing(true)
      setError(null)
      try {
        const list = (await api.listQuotes('all', text)).items
        if (mine === asked.current) setItems(list)
      } catch (e) {
        if (mine !== asked.current) return
        const failure = toApiError(e)
        // the quotes already on the screen stay; only the reason is said
        setError(failure.offline ? 'No signal. This list may be out of date.' : plainError(e))
        setItems((current) => current ?? [])
      } finally {
        if (mine === asked.current) setRefreshing(false)
      }
      // the account line is a courtesy: the list never waits on it
      api.accountNotice().then(setNotice, () => undefined)
      // so is the won line (the phone's time zone goes with it: the month starts at the business's midnight)
      api.bootstrap(phoneTimeZone()).then((start) => setWon(start.won ?? null), () => undefined)
    },
    [api]
  )

  // each time the tab is shown (with whatever is being searched for); and a moment after the search text stops changing
  const searching = useRef(search)
  searching.current = search
  useFocusEffect(
    useCallback(() => {
      void load(searching.current)
      // T-196: the first time the home tab is reached after signing in, ask about notifications (once, and not in the dev build)
      push.askOnHome()
    }, [load, push.askOnHome])
  )
  const firstSearch = useRef(true)
  useEffect(() => {
    // the tab's own showing has already loaded the list once
    if (firstSearch.current) {
      firstSearch.current = false
      return
    }
    const timer = setTimeout(() => void load(search), 350)
    return () => clearTimeout(timer)
  }, [search, load])

  const drafts = outbox.mine()
  const waiting = drafts.filter((d) => d.send !== 'editing')
  const unfinished = drafts.find((d) => d.send === 'editing' && (d.serviceId || d.photos.length > 0)) ?? null

  // what is on the phone narrows at once; the server's answer follows
  const groups: ListGroup[] = useMemo(() => groupQuotes((items ?? []).filter((item) => matchesSearch(item, search))), [items, search])
  const needsYou = groups.find((g) => g.key === 'needs_you')?.count ?? 0
  const loadingFirst = items === null
  const nothing = !loadingFirst && groups.length === 0 && waiting.length === 0 && !unfinished

  return (
    <Screen>
      <TopBar title="Quotes" note={loadingFirst ? null : needsYou > 0 ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : 'Nothing needs you right now'}>
        <View style={styles.search}>
          <Icon name="search" size={icon.small} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search by customer name"
            placeholder="Search by customer name"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            clearButtonMode="while-editing"
            maxFontSizeMultiplier={scale.large}
            style={styles.searchInput}
          />
        </View>
      </TopBar>

      <SectionList
        sections={groups.map((g) => ({ ...g, data: g.items }))}
        keyExtractor={(q) => q.quoteId}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(search, true)} tintColor={colors.brand} colors={[colors.brand]} />}
        ListHeaderComponent={
          <View style={{ paddingTop: space.md }}>
            {won && (won.headline || won.onSite) ? (
              <View style={styles.won} accessible accessibilityLabel={[won.headline, won.onSite].filter(Boolean).join('. ')}>
                {won.headline ? (
                  <Text style={styles.wonLine} maxFontSizeMultiplier={scale.text}>
                    {won.headline}
                  </Text>
                ) : null}
                {won.onSite ? (
                  <Text style={won.headline ? styles.wonQuiet : styles.wonLine} maxFontSizeMultiplier={scale.text}>
                    {won.onSite}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {notice ? <Notice tone={notice.kind === 'suspended' ? 'danger' : 'notice'}>{accountNoticeLine(notice)}</Notice> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            {waiting.length > 0 || unfinished ? <GroupHeader title={`On this ${DEVICE}`} count={waiting.length + (unfinished ? 1 : 0)} /> : null}
            {waiting.map((draft) => (
              <WaitingRow key={draft.id} draft={draft} onPress={() => router.navigate(`/new?draft=${draft.id}`)} />
            ))}
            {unfinished ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unfinished quote, ${draftTitle(unfinished)}. Saved on this ${DEVICE}. Carry on`}
                onPress={() => router.navigate('/new')}
                style={({ pressed }) => [styles.draftRow, pressed && { backgroundColor: colors.mint }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} maxFontSizeMultiplier={scale.text}>
                    Unfinished quote
                  </Text>
                  <Muted>
                    {draftTitle(unfinished)} · saved on this {DEVICE}. Tap to carry on.
                  </Muted>
                </View>
                <Icon name="chevron-forward" size={icon.small} color={colors.muted} />
              </Pressable>
            ) : null}
            {loadingFirst ? <SkeletonRows /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => {
          const group = section as unknown as ListGroup
          return <GroupHeader title={group.title} count={group.count} needsYou={group.key === 'needs_you'} />
        }}
        renderItem={({ item }) => <QuoteRow item={item} onPress={() => router.push(`/quote/${item.quoteId}`)} />}
        ListEmptyComponent={
          nothing ? (
            search.trim() ? (
              <EmptyState icon="search" title="No customer by that name" text="Check the spelling, or clear the search to see every quote." />
            ) : error ? undefined : (
              <EmptyState icon="document-text-outline" title="Your first quote" text="Pick a service, take the photos, answer a few questions. It takes a couple of minutes on site.">
                <Button title="Start a quote" icon="add" onPress={() => router.navigate('/new')} />
              </EmptyState>
            )
          ) : undefined
        }
      />
    </Screen>
  )
}

/** The phone's time zone name, when it can be read */
function phoneTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/** A group's name and how many are in it. "Needs you" carries the strong yellow and its dark marker (system.md, Status colours). */
function GroupHeader({ title, count, needsYou }: { title: string; count: number; needsYou?: boolean }) {
  return (
    <View style={styles.group} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${count}`}>
      <Text style={styles.groupTitle} maxFontSizeMultiplier={scale.large}>
        {title}
      </Text>
      <View style={[styles.count, needsYou && styles.countNeedsYou]}>
        {needsYou ? <View style={styles.countMarker} /> : null}
        <Text style={[styles.countText, needsYou && { color: colors.onAccent }]} maxFontSizeMultiplier={scale.large}>
          {count}
        </Text>
      </View>
    </View>
  )
}

function QuoteRow({ item, onPress }: { item: QuoteListItem; onPress: () => void }) {
  const words = rowWords(item)
  const turn = turnOfListItem(item)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words.spoken}
      accessibilityHint="Opens the quote"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.mint }]}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={styles.rowTop}>
          {/* a long name wraps onto more lines; the total beside it keeps its full width */}
          <Text style={[styles.name, { flex: 1, flexShrink: 1 }]} maxFontSizeMultiplier={scale.text}>
            {words.customer}
          </Text>
          {words.total ? (
            <Text style={styles.total} maxFontSizeMultiplier={scale.large}>
              {words.total}
            </Text>
          ) : null}
        </View>
        <Text style={styles.service} numberOfLines={2} maxFontSizeMultiplier={scale.text}>
          {words.service}
        </Text>
        <View style={styles.rowBottom}>
          <Pill label={words.state} tone={TONE_STYLE[turn.tone]} />
          {words.when ? (
            <Text style={styles.when} maxFontSizeMultiplier={scale.large}>
              {words.when}
            </Text>
          ) : null}
        </View>
        {words.detail ? <Muted>{words.detail}</Muted> : null}
      </View>
      <Icon name="chevron-forward" size={icon.small} color={colors.muted} />
    </Pressable>
  )
}

/** A quote that has not reached the server yet: it is on this device and sends by itself */
function WaitingRow({ draft, onPress }: { draft: Draft; onPress: () => void }) {
  const progress = draftProgress(draft)
  const line = forDevice(draft.problem ? draft.problem.message : draft.send === 'sending' ? 'Sending the job' : progress.line || OUTBOX_COPY.offline, DEVICE)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${draftTitle(draft)}. ${line}`}
      onPress={onPress}
      style={({ pressed }) => [styles.draftRow, { flexDirection: 'column', alignItems: 'stretch' }, pressed && { backgroundColor: colors.mint }]}
    >
      <Text style={styles.name} maxFontSizeMultiplier={scale.text}>
        {draftTitle(draft)}
      </Text>
      <Muted>{line}</Muted>
      <View style={{ marginTop: space.sm }}>
        <ProgressBar fraction={progress.fraction} label="Sending" />
      </View>
    </Pressable>
  )
}

/** Rows standing in for the list while it is fetched the first time */
function SkeletonRows() {
  return (
    <View accessible accessibilityLabel="Loading your quotes">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.row, { gap: space.sm }]}>
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="55%" height={18} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="35%" height={22} style={{ borderRadius: 11 }} />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  won: { marginBottom: space.md, gap: space.xs },
  wonLine: { color: colors.ink, fontFamily: fonts.bold, fontVariant: tabular, fontSize: type.large },
  wonQuiet: { color: colors.textSecondary, fontFamily: fonts.body, fontVariant: tabular, fontSize: type.body },
  search: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: radius.md,
    backgroundColor: colors.white,
  },
  searchInput: { flex: 1, minHeight: touch.min, color: colors.ink, fontFamily: fonts.body, fontSize: type.body, paddingVertical: space.sm },
  group: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.sm },
  groupTitle: { color: colors.ink, fontFamily: fonts.displayBold, fontSize: type.large },
  count: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 26, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  countNeedsYou: { backgroundColor: colors.accent },
  countMarker: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onAccent },
  countText: { color: colors.textSecondary, fontFamily: fonts.figureBold, fontVariant: tabular, fontSize: type.small },
  row: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    marginBottom: space.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowBottom: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
  draftRow: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.sm,
  },
  name: { color: colors.ink, fontFamily: fonts.bold, fontSize: type.large },
  service: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body },
  total: { flexShrink: 0, textAlign: 'right', color: colors.ink, fontFamily: fonts.figureBold, fontVariant: tabular, fontSize: type.large },
  when: { color: colors.muted, fontFamily: fonts.body, fontSize: type.small },
})
