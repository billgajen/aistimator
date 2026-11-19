/**
 * One quote: everything for this job (T-182, T-184).
 *
 * In reading order: where it stands and the price; the customer's photos;
 * anything to confirm on site; the price's lines; what else the customer
 * asked for; the progress steps; how to reach the customer; what was sent
 * with the request; the link; and one main action at the bottom, under the
 * thumb. While the price is worked out the same screen shows the stages and
 * then the price, without leaving.
 *
 * It follows the web's rules, none of them decided here:
 *   - a quote the business made on site is hidden from the customer until it
 *     is approved, so "Approve & send" approves and then opens the share sheet
 *   - a request with no price shows no figure: one held at the plan limit or
 *     by a paused account, and one that could not be priced
 *   - the minimum charge is a note above the total, never a line
 *   - a combined quote is one quote with one total; each added service is a section
 *   - line names and where each quantity came from are the server's (T-183)
 *   - nothing is edited here: "Edit in the dashboard" opens the web quote
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { customerFirstName, formatMoney, parseMoneyInput, quoteTracker, QUOTE_TURN_COPY, type AppQuoteSection, type AppQuoteView } from '@qolumns/shared'
import { useApi } from '../../src/lib/api-context'
import { toApiError } from '../../src/lib/api'
import { config } from '../../src/lib/config'
import { plainError, PLAIN } from '../../src/lib/errors'
import { done } from '../../src/lib/feel'
import { setViewerPhotos } from '../../src/lib/photo-viewer'
import { canRecordInvoice, headlinePrice, isPricing, mainAction, minimumNote, priceLines } from '../../src/lib/price'
import { pricingStages } from '../../src/lib/pricing-stages'
import { loadQuoteToken, saveQuoteToken } from '../../src/lib/quote-tokens'
import { evidenceWords, shareMessage } from '../../src/lib/share'
import { TONE_STYLE, turnOfQuote } from '../../src/lib/status'
import { PricingStages } from '../../src/components/PricingStages'
import { Body, BottomBar, Button, Card, ErrorText, Field, Icon, Label, LinkRow, MoneyRow, Muted, Notice, Pill, Rows, Screen, Skeleton, Title } from '../../src/components/ui'
import { colors, fonts, icon, radius, scale, space, touch, type } from '../../src/theme'

/** How often the screen asks again while the price is worked out (first price takes 20 to 60 seconds) */
const POLL_MS = 3000

export default function QuoteDetail() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>()
  const api = useApi()
  const router = useRouter()
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
        setError(plainError(e, 'This quote could not be opened. Go back and try again.'))
      }
      return null
    }
  }, [api, id])

  useEffect(() => {
    alive.current = true
    void load()
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
      setError(plainError(e))
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

  const copyLink = () =>
    run(async () => {
      if (!quote) return
      await Clipboard.setStringAsync(await linkFor(quote))
      done()
      setNote('Link copied. Paste it into a message to the customer.')
    })

  // T-146: one tap approves a quote that is waiting for the business, then hands over its link
  const approveAndSend = () =>
    run(async () => {
      if (!quote) return
      const result = await api.approveQuote(quote.id)
      done()
      const freshQuote = (await load()) ?? { ...quote, status: 'sent' as const }
      if (result.emailed) setNote(`${customerFirstName(quote.customerName) ?? 'The customer'} was emailed the link too.`)
      await openShareSheet(freshQuote)
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

  const open = (url: string) =>
    void Linking.openURL(url).catch(() => setError('That could not be opened on this phone.'))

  // ---- Not loaded yet. A job that was just sent shows its stages at once, with no blank moment. ----
  if (!quote) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : fresh ? (
            <Card>
              <Title>Pricing this job</Title>
              <PricingStages stages={pricingStages({ photosTotal: 0, photosDone: 0, sent: true, status: 'queued', waitingForSignal: offline })} />
            </Card>
          ) : (
            <View accessible accessibilityLabel={offline ? 'No signal. Trying again' : 'Loading the quote'}>
              {offline ? <Notice>{PLAIN.offline}</Notice> : null}
              <Card>
                <Skeleton width="60%" height={26} />
                <Skeleton width="40%" height={16} style={{ marginTop: space.md }} />
                <Skeleton width="50%" height={40} style={{ marginTop: space.lg }} />
              </Card>
              <Card>
                <Skeleton width="100%" height={16} />
                <Skeleton width="90%" height={16} style={{ marginTop: space.md }} />
                <Skeleton width="70%" height={16} style={{ marginTop: space.md }} />
              </Card>
            </View>
          )}
        </ScrollView>
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
  const photoCount = Math.max(quote.photoCount ?? 0, photos.length)
  const hasRequest = Boolean(request && (request.description || request.answers.length > 0 || request.address || request.postcode))
  const pricing = isPricing(quote.status)
  const sentToCustomer = action === 'share'
  const tracker = quoteTracker({
    status: quote.status,
    total: quote.pricing.total,
    held: quote.held === true,
    createdAt: quote.createdAt,
    approvedAt: quote.dates?.approvedAt ?? null,
    sentAt: quote.dates?.sentAt ?? null,
    viewedAt: quote.dates?.viewedAt ?? null,
    acceptedAt: quote.dates?.acceptedAt ?? null,
    paidAt: quote.dates?.paidAt ?? null,
    declinedAt: quote.dates?.declinedAt ?? null,
    expiresAt: quote.dates?.expiresAt ?? null,
  })

  function viewPhoto(index: number) {
    setViewerPhotos(photos.map((p) => ({ id: p.id, url: p.fullUrl ?? p.url })))
    router.push(`/photo?index=${index}`)
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        {offline ? <Notice>No signal. This page may be out of date.</Notice> : null}

        {/* 1. Who, what, where it stands, the price */}
        <Card>
          <Text accessibilityRole="header" style={styles.customer} maxFontSizeMultiplier={scale.large}>
            {customer.name || 'Customer'}
          </Text>
          <Text style={styles.service} maxFontSizeMultiplier={scale.text}>
            {quote.serviceName}
          </Text>

          {pricing ? (
            // the stages, in the same place the price will be
            <PricingStages stages={pricingStages({ photosTotal: photoCount, photosDone: photoCount, sent: true, status: quote.status, waitingForSignal: offline })} />
          ) : (
            <>
              <View style={{ marginTop: space.md }}>
                <Pill label={turn.label} tone={TONE_STYLE[turn.tone]} />
              </View>
              {figure ? (
                <Text style={styles.total} accessibilityLabel={`Total ${figure}`} maxFontSizeMultiplier={scale.large} adjustsFontSizeToFit numberOfLines={1}>
                  {figure}
                </Text>
              ) : null}
              {/* How sure the price is, in the sentence the dashboard gives the business. No grade letter: that is internal. */}
              {figure && estimate?.description ? <Muted>{estimate.description}</Muted> : null}
              <Body style={{ marginTop: space.md }}>{turn.sentence}</Body>
              {action === 'price_request' ? <Muted>Your plan is managed on the web, in your dashboard.</Muted> : null}
              {action === 'add_price' ? <Muted>The price is added on the web, in your dashboard.</Muted> : null}
              {action === 'send' && customer.email ? <Muted>{first ?? 'The customer'} is also emailed the link when you approve.</Muted> : null}
            </>
          )}
          {note ? (
            <Text accessibilityRole="alert" style={styles.note} maxFontSizeMultiplier={scale.text}>
              {note}
            </Text>
          ) : null}
        </Card>

        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* 2. The customer's photos: small copies, tap one to see it full screen */}
        {photoCount > 0 ? (
          <Card>
            <Label>{photoCount === 1 ? '1 photo' : `${photoCount} photos`}</Label>
            {photos.length > 0 ? (
              <View style={styles.photos}>
                {photos.map((photo, i) => (
                  <PhotoTile key={photo.id} uri={photo.url} label={`Photo ${i + 1} of ${photos.length}. Opens full screen`} onPress={() => viewPhoto(i)} onRetry={() => void load()} />
                ))}
              </View>
            ) : pricing ? (
              <Muted>They show here when the price is ready.</Muted>
            ) : (
              <>
                <Muted>The photos could not be shown just now.</Muted>
                <Button title="Try again" variant="quiet" onPress={() => void load()} />
              </>
            )}
          </Card>
        ) : null}

        {/* 3. Open questions, answered on site */}
        {action === 'confirm' ? (
          <Card>
            <Label>Confirm on site</Label>
            <Muted>Your answer is treated as confirmed and fixes the price.</Muted>
            {quote.questions.map((q) => {
              const words = evidenceWords(q.evidence)
              return (
                <View key={q.id} style={{ marginTop: space.lg }}>
                  <Text style={styles.question} maxFontSizeMultiplier={scale.text}>
                    {q.question}
                  </Text>
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

        {/* 4. The price: lines, the minimum as a note, added services as sections, one total */}
        {figure && (lines.length > 0 || combined) ? (
          <Card>
            <Label>{combined ? (quote.mainServiceName ?? 'Price') : 'Price'}</Label>
            {lines.map((line, i) => (
              // where the quantity came from, in the business's words (the server's, T-183); else what the customer was told
              <MoneyRow key={`${line.label}-${i}`} label={line.label} note={line.source ?? line.method} amount={formatMoney(line.amount, currency)} />
            ))}
            {minimumNote(quote.minimum, currency) ? <Muted>{minimumNote(quote.minimum, currency)}</Muted> : null}
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

        {/* 5. What else the customer asked for (T-179), and where each stands */}
        {quote.alsoAsked && quote.alsoAsked.length > 0 ? (
          <Card>
            <Label>Customer also asked for</Label>
            {quote.alsoAsked.map((item, i) => (
              <View key={i} style={[styles.asked, i > 0 && styles.askedLine]}>
                {item.serviceName ? <Body style={{ fontFamily: fonts.semi }}>{item.serviceName}</Body> : null}
                <Body>“{item.words}”</Body>
                <Muted>{item.stateWords}</Muted>
              </View>
            ))}
          </Card>
        ) : null}

        {/* 6. Where it stands: received, approved, opened by the customer, accepted (T-158) */}
        {!pricing ? (
          <Card>
            <Label>{QUOTE_TURN_COPY.tracker.title}</Label>
            {tracker.map((step) => (
              <View key={step.key} style={styles.step} accessible accessibilityLabel={`${step.label}${step.date ? `, ${step.date}` : ''}${step.note ? `, ${step.note}` : ''}. ${step.done ? 'Done' : 'Not yet'}`}>
                <View style={[styles.stepMark, step.done && (step.ended ? styles.stepEnded : styles.stepDone)]}>
                  {step.done ? <Icon name={step.ended ? 'close' : 'checkmark'} size={14} color={colors.white} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stepLabel, !step.done && { color: colors.muted, fontFamily: fonts.body }]} maxFontSizeMultiplier={scale.text}>
                    {step.label}
                  </Text>
                  {step.note ? <Muted style={{ marginTop: 0 }}>{step.note}</Muted> : null}
                </View>
                {step.date ? (
                  <Text style={styles.stepDate} maxFontSizeMultiplier={scale.large}>
                    {step.date}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {/* 7. Reaching the customer */}
        {customer.phone || customer.email ? (
          <Card>
            <Label>{customer.name || 'Customer'}</Label>
            <View style={{ gap: space.sm }}>
              {customer.phone ? (
                <>
                  <Button title={QUOTE_TURN_COPY.pageButtons.call(first)} icon="call-outline" variant="secondary" note={customer.phone} onPress={() => open(`tel:${customer.phone}`)} />
                  <Button title={`Message ${first ?? 'customer'}`} icon="chatbubble-outline" variant="secondary" onPress={() => open(`sms:${customer.phone}`)} />
                </>
              ) : null}
              {customer.email ? (
                <Button title={QUOTE_TURN_COPY.pageButtons.email(first)} icon="mail-outline" variant="secondary" note={customer.email} onPress={() => open(`mailto:${customer.email}`)} />
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* 8. What was sent with the request: all there is to go on when it could not be priced */}
        {hasRequest ? (
          <Card>
            <Label>The request</Label>
            {request?.description ? <Body>{request.description}</Body> : null}
            {request?.answers.map((a, i) => (
              <View key={`${a.label}-${i}`} style={styles.answer} accessible accessibilityLabel={`${a.label}: ${a.value}`}>
                <Muted>{a.label}</Muted>
                <Body>{a.value}</Body>
              </View>
            ))}
            {request?.address || request?.postcode ? (
              <View style={styles.answer}>
                <Muted>Where</Muted>
                <Body>{[request.address, request.postcode].filter(Boolean).join(', ')}</Body>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* 9. The customer's link, once they have the quote */}
        {sentToCustomer ? (
          <Card>
            <Label>The customer’s link</Label>
            <LinkRow title="Send the link again" note="Text, WhatsApp or email" icon="share-outline" onPress={share} />
            <LinkRow title={QUOTE_TURN_COPY.more.copyLink} icon="copy-outline" onPress={copyLink} last />
          </Card>
        ) : null}

        {canRecordInvoice(quote.status) ? (
          <Card>
            <Label>Final invoice</Label>
            <Muted>What you finally charged. It measures how close your estimates are.</Muted>
            {invoiceSaved !== null ? <Body>Saved: {formatMoney(invoiceSaved, currency)}</Body> : null}
            <View style={{ height: space.md }} />
            <Field label={`Invoiced amount (${currency})`} value={invoice} onChangeText={setInvoice} keyboardType="decimal-pad" />
            <Button title="Save final invoice" variant="secondary" onPress={saveInvoice} busy={busy} disabled={parseMoneyInput(invoice) === null} />
          </Card>
        ) : null}

        {/* 10. Nothing is edited in the app */}
        {!pricing ? (
          <Card>
            <LinkRow
              title="Edit in the dashboard"
              note="Change a line, the wording or the services on the web"
              icon="open-outline"
              onPress={() => open(`${config.apiUrl}/app/quotes/${encodeURIComponent(quote.id)}`)}
              last
            />
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
          <Button title={QUOTE_TURN_COPY.pageButtons.approve} icon="send" note="Then choose how to send the link" onPress={approveAndSend} busy={busy} />
        </BottomBar>
      ) : action === 'share' ? (
        <BottomBar>
          <Button title="Send the link" icon="share-outline" note="Text, WhatsApp, email or copy" onPress={share} busy={busy} />
        </BottomBar>
      ) : action === 'price_request' ? (
        <BottomBar>
          <Button title={QUOTE_TURN_COPY.pageButtons.priceRequest} onPress={priceRequest} busy={busy} />
        </BottomBar>
      ) : null}
    </Screen>
  )
}

/**
 * One of the customer's photos, small. It says so if it cannot be loaded (a
 * signed address lasts a few minutes) and a tap asks for fresh ones.
 */
function PhotoTile({ uri, label, onPress, onRetry }: { uri: string; label: string; onPress: () => void; onRetry: () => void }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading')
  // a fresh address is a fresh try
  useEffect(() => setState('loading'), [uri])
  if (state === 'failed') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="This photo could not be loaded. Try again" onPress={onRetry} style={[styles.photo, styles.photoFailed]}>
        <Icon name="refresh" size={icon.row} color={colors.textSecondary} />
        <Text style={styles.photoFailedText} maxFontSizeMultiplier={scale.large}>
          Try again
        </Text>
      </Pressable>
    )
  }
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.photo, pressed && { opacity: 0.8 }]}>
      <Image source={{ uri }} style={styles.photoImage} onLoad={() => setState('shown')} onError={() => setState('failed')} accessibilityIgnoresInvertColors />
    </Pressable>
  )
}

/** A service added to the quote (T-179): its own lines and subtotal, inside the one quote */
function Section({ section, currency }: { section: AppQuoteSection; currency: string }) {
  return (
    <View style={styles.section}>
      <Label>{section.serviceName}</Label>
      <Muted>{section.addedBy === 'customer' ? 'Added by the customer' : 'Added by you'}</Muted>
      {section.awaitingApproval ? <Muted>Waiting for your approval. The customer does not see this part’s price yet.</Muted> : null}
      {section.lines.map((line, i) => (
        <MoneyRow key={`${line.label}-${i}`} label={line.label} note={line.source} amount={formatMoney(line.amount, currency)} />
      ))}
      {minimumNote(section.minimum, currency) ? <Muted>{minimumNote(section.minimum, currency)}</Muted> : null}
      <MoneyRow label={`${section.serviceName} subtotal`} amount={formatMoney(section.subtotal, currency)} strong />
    </View>
  )
}

const styles = StyleSheet.create({
  customer: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, letterSpacing: -0.3 },
  service: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body, marginTop: 2 },
  total: { color: colors.ink, fontFamily: fonts.figureBold, fontSize: type.figure, marginTop: space.md },
  note: { color: colors.secondary, fontFamily: fonts.semi, fontSize: type.body, marginTop: space.md },
  question: { color: colors.ink, fontFamily: fonts.bold, fontSize: type.large },
  section: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  totals: { marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.lineStrong },
  answer: { marginTop: space.md },
  asked: { paddingVertical: space.sm },
  askedLine: { borderTopWidth: 1, borderTopColor: colors.line },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min },
  stepMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  stepEnded: { backgroundColor: colors.muted, borderColor: colors.muted },
  stepLabel: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body },
  stepDate: { color: colors.textSecondary, fontFamily: fonts.figure, fontSize: type.small },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.mist, overflow: 'hidden' },
  photoImage: { width: 96, height: 96 },
  photoFailed: { alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: colors.lineStrong, borderStyle: 'dashed' },
  photoFailedText: { color: colors.textSecondary, fontFamily: fonts.semi, fontSize: type.note },
})
