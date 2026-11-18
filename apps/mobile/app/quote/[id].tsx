/**
 * One quote, as the business reads it (T-182): whose turn it is and the next
 * step in the dashboard's own words, the price, its lines, and one main
 * action at the bottom of the screen.
 *
 * It follows the web's rules, none of them decided here:
 *   - a quote the business made on site is hidden from the customer until it
 *     is approved, so "Approve & send" approves and then opens the share sheet
 *   - a request with no price shows no figure: one held at the plan limit or
 *     by a paused account, and one that could not be priced
 *   - the minimum charge is a note above the total, never a line
 *   - a combined quote is one quote with one total; each added service is a section
 *   - a request that could not be priced still shows what was sent, and its photos
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { customerFirstName, formatMoney, parseMoneyInput, QUOTE_TURN_COPY, type AppQuoteSection, type AppQuoteView } from '@qolumns/shared'
import { useApi } from '../../src/lib/api-context'
import { toApiError } from '../../src/lib/api'
import { canRecordInvoice, headlinePrice, isPricing, mainAction, minimumNote, priceLines } from '../../src/lib/price'
import { loadQuoteToken, saveQuoteToken } from '../../src/lib/quote-tokens'
import { evidenceWords, shareMessage } from '../../src/lib/share'
import { TONE_STYLE, turnOfQuote } from '../../src/lib/status'
import { BottomBar, Button, Card, ErrorText, Field, Label, MoneyRow, Muted, Notice, Pill, Rows, Screen } from '../../src/components/ui'
import { colors, radius, space, type } from '../../src/theme'

/** How often the screen asks again while the price is worked out (first price takes 20 to 60 seconds) */
const POLL_MS = 3000

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const [quote, setQuote] = useState<AppQuoteView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [invoice, setInvoice] = useState('')
  const [invoiceSaved, setInvoiceSaved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const load = useCallback(async (): Promise<AppQuoteView | null> => {
    if (timer.current) clearTimeout(timer.current)
    try {
      const q = await api.getQuote(id)
      if (!alive.current) return q
      setQuote(q)
      setOffline(false)
      // Keep asking while the worker prices
      if (isPricing(q.status)) timer.current = setTimeout(load, POLL_MS)
      return q
    } catch (e) {
      if (!alive.current) return null
      const failure = toApiError(e)
      if (failure.retryable) {
        // a lost signal does not end the wait: the price is still being worked out
        setOffline(true)
        timer.current = setTimeout(load, POLL_MS * 2)
      } else {
        setError(failure.message)
      }
      return null
    }
  }, [api, id])

  useEffect(() => {
    alive.current = true
    load()
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  /** Run one action: one at a time, with its failure said in plain words */
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await action()
    } catch (e) {
      const failure = toApiError(e)
      setError(failure.offline ? 'No signal. Nothing was lost. Try again when you are back online.' : failure.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const answerOf = (q: AppQuoteView['questions'][number]) => answers[q.id] ?? (q.aiValue !== undefined ? String(q.aiValue) : '')

  const confirm = () =>
    run(async () => {
      if (!quote) return
      const stored = await loadQuoteToken(quote.id)
      await api.answerQuestions(
        quote.id,
        quote.questions.map((q) => ({ questionId: q.id, answer: answerOf(q) })),
        stored?.token
      )
      setAnswers({})
      await load()
    })

  /** The customer's link: the one this phone kept, or a new one (every earlier link keeps working) */
  async function linkFor(q: AppQuoteView): Promise<string> {
    const stored = q.status === 'expired' ? null : await loadQuoteToken(q.id)
    if (stored) return stored.viewUrl
    const { quoteViewUrl } = await api.quoteLink(q.id)
    await saveQuoteToken(q.id, quoteViewUrl).catch(() => undefined)
    return quoteViewUrl
  }

  async function openShareSheet(q: AppQuoteView) {
    const url = await linkFor(q)
    // the phone's own sheet: a text, WhatsApp, an email, or copy
    await Share.share({ message: shareMessage(q.businessName, url) })
  }

  const share = () => run(async () => (quote ? openShareSheet(quote) : undefined))

  // T-146: one tap approves a quote that is waiting for the business, then hands over its link
  const approveAndSend = () =>
    run(async () => {
      if (!quote) return
      const result = await api.approveQuote(quote.id)
      const fresh = (await load()) ?? { ...quote, status: 'sent' as const }
      if (result.emailed) setNote(`${customerFirstName(quote.customerName) ?? 'The customer'} was emailed the link too.`)
      await openShareSheet(fresh)
    })

  // T-134: a request saved at the plan limit is priced once a plan has room for it
  const priceRequest = () =>
    run(async () => {
      if (!quote) return
      await api.priceHeldRequest(quote.id)
      await load()
    })

  const saveInvoice = () =>
    run(async () => {
      const amount = parseMoneyInput(invoice)
      if (!quote || amount === null) return
      const saved = await api.recordFinalInvoice(quote.id, amount)
      setInvoiceSaved(saved.finalInvoiceAmount)
      setInvoice('')
    })

  if (!quote) {
    return (
      <Screen>
        <View style={{ padding: space.lg }}>
          {error ? <ErrorText>{error}</ErrorText> : <Muted>{offline ? 'No signal. Trying again…' : 'Loading…'}</Muted>}
        </View>
      </Screen>
    )
  }

  const { estimate, currency } = quote.pricing
  const turn = turnOfQuote(quote)
  const action = mainAction(quote)
  const figure = headlinePrice(quote)
  const lines = priceLines(quote)
  const sections = quote.sections ?? []
  const combined = sections.length > 0
  const customer = quote.customer ?? { name: quote.customerName, email: null, phone: null }
  const first = customerFirstName(customer.name)
  const allAnswered = quote.questions.every((q) => answerOf(q).trim() !== '')
  const request = quote.request
  const photos = quote.photos ?? []
  const hasRequest = Boolean(request && (request.description || request.answers.length > 0 || request.address || request.postcode))

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        {offline ? <Notice>No signal. This page may be out of date.</Notice> : null}

        {/* 1. Whose turn it is, the price, the next step */}
        <Card>
          <Text style={styles.customer}>{customer.name || 'Customer'}</Text>
          <Text style={styles.service}>{quote.serviceName}</Text>
          <View style={{ marginTop: space.md }}>
            <Pill label={turn.label} tone={TONE_STYLE[turn.tone]} />
          </View>
          {figure ? (
            <Text style={styles.total} accessibilityLabel={`Total ${figure}`}>
              {figure}
            </Text>
          ) : null}
          {figure && estimate ? (
            <Text style={styles.grade}>
              Grade {estimate.grade} · {estimate.label}
            </Text>
          ) : null}
          <Text style={styles.sentence}>{turn.sentence}</Text>
          {action === 'price_request' ? <Muted>Plans are changed on the web, in your dashboard under Settings, Billing.</Muted> : null}
          {action === 'add_price' ? <Muted>The price is added on the web, in your dashboard.</Muted> : null}
          {action === 'send' && customer.email ? <Muted>{first ?? 'The customer'} is also emailed the link when you approve.</Muted> : null}
          {note ? <Muted>{note}</Muted> : null}
        </Card>

        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* 2. Open questions, answered on site */}
        {action === 'confirm' ? (
          <Card>
            <Label>Confirm on site</Label>
            <Muted>Your answer is treated as confirmed and fixes the price.</Muted>
            {quote.questions.map((q) => {
              const words = evidenceWords(q.evidence)
              return (
                <View key={q.id} style={{ marginTop: space.lg }}>
                  <Text style={styles.question}>{q.question}</Text>
                  {words ? <Muted>{words.line}</Muted> : null}
                  {words?.labelText ? <Muted>The label says: {words.labelText}</Muted> : null}
                  <View style={{ height: space.sm }} />
                  {q.options && q.options.length > 0 ? (
                    <Rows options={q.options.map((o) => ({ value: o, label: o }))} value={answerOf(q) || undefined} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  ) : (
                    <Field
                      label={q.aiValue !== undefined ? 'Correct it if it is wrong' : 'Your answer'}
                      value={answerOf(q)}
                      onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                      keyboardType={typeof q.aiValue === 'number' ? 'decimal-pad' : 'default'}
                    />
                  )}
                </View>
              )
            })}
          </Card>
        ) : null}

        {/* 3. The price: lines, the minimum as a note, added services as sections, one total */}
        {figure && (lines.length > 0 || combined) ? (
          <Card>
            <Label>{combined ? (quote.mainServiceName ?? 'Price') : 'Price'}</Label>
            {lines.map((line, i) => (
              <MoneyRow key={`${line.label}-${i}`} label={line.label} note={line.method} amount={formatMoney(line.amount, currency)} />
            ))}
            {minimumNote(quote.minimum, currency) ? <Text style={styles.minimum}>{minimumNote(quote.minimum, currency)}</Text> : null}
            {combined && quote.mainSubtotal !== undefined ? (
              <MoneyRow label={`${quote.mainServiceName ?? 'Service'} subtotal`} amount={formatMoney(quote.mainSubtotal, currency)} strong />
            ) : null}

            {sections.map((section, i) => (
              <Section key={`${section.serviceName}-${i}`} section={section} currency={currency} />
            ))}

            <View style={styles.totals}>
              {quote.totals && (combined || quote.totals.tax) ? <MoneyRow label="Subtotal" amount={formatMoney(quote.totals.subtotal, currency)} /> : null}
              {quote.totals?.tax ? <MoneyRow label={quote.totals.tax.label} amount={formatMoney(quote.totals.tax.amount, currency)} /> : null}
              <MoneyRow label={combined ? 'Total for everything' : 'Total'} amount={formatMoney(quote.pricing.total, currency)} strong />
            </View>
          </Card>
        ) : null}

        {/* 4. What was sent with the request: all there is to go on when it could not be priced */}
        {hasRequest || photos.length > 0 ? (
          <Card>
            <Label>The request</Label>
            {request?.description ? <Text style={styles.body}>{request.description}</Text> : null}
            {request?.answers.map((a, i) => (
              <View key={`${a.label}-${i}`} style={styles.answer}>
                <Muted>{a.label}</Muted>
                <Text style={styles.body}>{a.value}</Text>
              </View>
            ))}
            {request?.address || request?.postcode ? (
              <View style={styles.answer}>
                <Muted>Where</Muted>
                <Text style={styles.body}>{[request.address, request.postcode].filter(Boolean).join(', ')}</Text>
              </View>
            ) : null}
            {photos.length > 0 ? (
              <View style={styles.photos}>
                {photos.map((photo, i) => (
                  <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={`Photo ${i + 1} of ${photos.length}`} />
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* 5. Reaching the customer (the main thing to do when a request could not be priced) */}
        {customer.phone || customer.email ? (
          <Card>
            <Label>{customer.name || 'Customer'}</Label>
            <View style={{ gap: space.sm }}>
              {customer.phone ? (
                <Button title={QUOTE_TURN_COPY.pageButtons.call(first)} variant="secondary" note={customer.phone} onPress={() => void Linking.openURL(`tel:${customer.phone}`)} />
              ) : null}
              {customer.email ? (
                <Button title={QUOTE_TURN_COPY.pageButtons.email(first)} variant="secondary" note={customer.email} onPress={() => void Linking.openURL(`mailto:${customer.email}`)} />
              ) : null}
            </View>
          </Card>
        ) : null}

        {canRecordInvoice(quote.status) ? (
          <Card>
            <Label>Final invoice</Label>
            <Muted>What you finally charged. It measures how close your estimates are.</Muted>
            {invoiceSaved !== null ? <Text style={styles.body}>Saved: {formatMoney(invoiceSaved, currency)}</Text> : null}
            <View style={{ height: space.md }} />
            <Field label={`Invoiced amount (${currency})`} value={invoice} onChangeText={setInvoice} keyboardType="decimal-pad" />
            <Button title="Save final invoice" variant="secondary" onPress={saveInvoice} busy={busy} disabled={parseMoneyInput(invoice) === null} />
          </Card>
        ) : null}
      </ScrollView>

      {/* The one main action, under the thumb */}
      {action === 'confirm' ? (
        <BottomBar>
          <Button title="Confirm and reprice" onPress={confirm} busy={busy} disabled={!allAnswered} />
        </BottomBar>
      ) : action === 'send' ? (
        <BottomBar>
          <Button title={QUOTE_TURN_COPY.pageButtons.approve} note="Then choose how to send the link" onPress={approveAndSend} busy={busy} />
        </BottomBar>
      ) : action === 'share' ? (
        <BottomBar>
          <Button title="Send the link" note="Text, WhatsApp, email or copy" onPress={share} busy={busy} />
        </BottomBar>
      ) : action === 'price_request' ? (
        <BottomBar>
          <Button title={QUOTE_TURN_COPY.pageButtons.priceRequest} onPress={priceRequest} busy={busy} />
        </BottomBar>
      ) : null}
    </Screen>
  )
}

/** A service added to the quote (T-179): its own lines and subtotal, inside the one quote */
function Section({ section, currency }: { section: AppQuoteSection; currency: string }) {
  return (
    <View style={styles.section}>
      <Label>{section.serviceName}</Label>
      <Muted>{section.addedBy === 'customer' ? 'Added by the customer' : 'Added by you'}</Muted>
      {section.awaitingApproval ? <Muted>Waiting for your approval. The customer does not see this part's price yet.</Muted> : null}
      {section.lines.map((line, i) => (
        <MoneyRow key={`${line.label}-${i}`} label={line.label} amount={formatMoney(line.amount, currency)} />
      ))}
      {minimumNote(section.minimum, currency) ? <Text style={styles.minimum}>{minimumNote(section.minimum, currency)}</Text> : null}
      <MoneyRow label={`${section.serviceName} subtotal`} amount={formatMoney(section.subtotal, currency)} strong />
    </View>
  )
}

const styles = StyleSheet.create({
  customer: { color: colors.ink, fontSize: type.title, fontWeight: '800' },
  service: { color: colors.textSecondary, fontSize: type.body, marginTop: 2 },
  total: { color: colors.ink, fontSize: type.figure, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: space.md },
  // the grade is a measurement mark: butter is its ground
  grade: {
    alignSelf: 'flex-start',
    color: colors.ink,
    fontWeight: '600',
    fontSize: type.small,
    backgroundColor: colors.butter,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    marginTop: space.xs,
    overflow: 'hidden',
  },
  sentence: { color: colors.ink, fontSize: type.body, lineHeight: 22, marginTop: space.md },
  question: { color: colors.ink, fontWeight: '700', fontSize: type.large },
  minimum: { color: colors.textSecondary, fontSize: type.small, marginVertical: space.xs },
  section: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  totals: { marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.lineStrong },
  body: { color: colors.ink, fontSize: type.body, lineHeight: 22 },
  answer: { marginTop: space.md },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.mist },
})
