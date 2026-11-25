/**
 * One quote: everything for this job (T-182, T-184).
 *
 * In reading order: where it stands and the price; the customer's photos;
 * the business's own questions, when it made the quote; the price's lines; what else the customer
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
 *   - T-186: the status chip, the sentence, Progress and the main button are
 *     one result of the shared `quoteStory`, so they tell one story. A quote
 *     the business made asks the business; a customer's asks the customer, and
 *     then this screen asks nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Image, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { ANSWER_NOTE_MAX, allAnswered, roomScanView, type RoomScanRoom, certaintySentence, chosenChoice, customerFirstName, FINAL_INVOICE_ASK, finalInvoiceLooksOff, formatMoney, isTypedAnswer, lineLabelParts, noteToSend, parseMoneyInput, questionChoices, questionTextBox, QUOTE_TURN_COPY, type AppQuoteLine, type AppQuoteSection, type AppQuoteView } from '@qolumns/shared'
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
import { storyOfQuote, TONE_STYLE } from '../../src/lib/status'
import { TRY_AGAIN_BUTTON, TRY_AGAIN_STARTED, TRY_AGAIN_USED, tryAgainError, tryAgainState } from '../../src/lib/try-again'
import { PricingStages } from '../../src/components/PricingStages'
import { EstimateReport } from '../../src/components/EstimateReport'
import { RoomScanCard, RoomScanSummary, SCAN_TIP } from '../../src/components/RoomScanSummary'
import { canOpenPage, openPage, removeModelFile, roomScanAvailability, scanRoom } from '../../modules/room-scan'
import { loadAreaNames, putPhoto, saveAreaNames } from '../../src/lib/device-files'
import { rememberAreaName } from '../../src/lib/area-names'
import { viewerAddress } from '../../src/lib/model-viewer'
import { ROOM_MODEL_CONTENT_TYPE } from '../../src/lib/outbox'
import { currentUserId } from '../../src/lib/supabase'
import { Body, BottomBar, Button, Card, ErrorText, Field, Icon, KeyboardSpace, Label, LinkRow, MoneyRow, Muted, Notice, Pill, Rows, Screen, Skeleton, Title } from '../../src/components/ui'
import { colors, fonts, icon, radius, scale, space, tabular, touch, type } from '../../src/theme'

/** How often the screen asks again while the price is worked out (first price takes 20 to 60 seconds) */
const POLL_MS = 3000

/** The row that opens a typed answer. Never sent: pressing it sets the answer to empty text. */
const OTHER = '\u0000other'

export default function QuoteDetail() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>()
  const api = useApi()
  const router = useRouter()
  const [quote, setQuote] = useState<AppQuoteView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({})
  // T-188: the optional note with each answer, and whether the business is answering for the customer
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [forCustomer, setForCustomer] = useState(false)
  const [invoice, setInvoice] = useState('')
  const [invoiceSaved, setInvoiceSaved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // T-202: "Try again" was pressed on this screen; said while the price is worked out again
  const [triedAgain, setTriedAgain] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  // T-194: an area just scanned again (`index`) or added, named before it is sent
  const [pending, setPending] = useState<{ index?: number; geometry: RoomScanRoom; model?: { uri: string; sizeBytes: number } } | null>(null)
  const [areaNames, setAreaNames] = useState<string[]>([])
  // T-201: "View in 3D" shows where the viewer can open. On Android that is the phone's browser, so the
  // phone is asked first; until it has answered (and if it says no) the button is not there.
  const [modelOpens, setModelOpens] = useState(Platform.OS === 'ios')
  useEffect(() => {
    if (Platform.OS === 'ios') return
    let live = true
    void canOpenPage(config.apiUrl).then((can) => live && setModelOpens(can))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    const owner = currentUserId()
    if (owner) void loadAreaNames(owner).then(setAreaNames)
  }, [])

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

  // T-202: once the try has ended with a price, "Pricing started" is not said for a later pricing (a new scan, an answer)
  const status = quote?.status
  useEffect(() => {
    if (status && status !== 'failed' && !isPricing(status)) setTriedAgain(false)
  }, [status])

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

  const setAnswer = (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value }))

  /** T-194: scan an area again (`index`) or a new one; it is named and checked here before it is sent */
  async function scanArea(index?: number) {
    setError(null)
    try {
      const { modelUri, modelSizeBytes, ...geometry } = await scanRoom()
      const before = index !== undefined ? quote?.roomScan?.rooms[index] : undefined
      setPending({
        index,
        geometry: { ...geometry, name: before?.name ?? '', roomsCovered: before?.roomsCovered ?? 1 },
        ...(modelUri && modelSizeBytes && modelSizeBytes > 0 && { model: { uri: modelUri, sizeBytes: Number(modelSizeBytes) } }),
      })
    } catch (e) {
      const cancelled = e instanceof Error && /cancel/i.test(e.message)
      if (!cancelled) setError('The scan did not finish. Try again.')
    }
  }

  /** The area goes to the quote, which is priced again; its model is uploaded first and never holds it up */
  const sendArea = () =>
    run(async () => {
      if (!quote || !pending) return
      let modelId: string | undefined
      if (pending.model) {
        try {
          const started = await api.startModelUpload(pending.model.sizeBytes)
          await putPhoto(started.uploadUrl, { uri: pending.model.uri, contentType: ROOM_MODEL_CONTENT_TYPE }, () => {})
          modelId = started.modelId
        } catch {
          // the sizes go without the 3D model
        }
      }
      const name = (pending.geometry.name ?? '').trim()
      await api.rescan(quote.id, { ...pending.geometry, ...(name ? { name } : { name: undefined }), ...(modelId && { modelId }) }, pending.index)
      if (pending.model) removeModelFile(pending.model.uri)
      const owner = currentUserId()
      if (owner && name) {
        const names = rememberAreaName(areaNames, name)
        setAreaNames(names)
        void saveAreaNames(owner, names)
      }
      setPending(null)
      await load()
    })

  /** T-194: an area's model in the web's viewer, in the in-app browser */
  function viewModel(index: number) {
    const area = quote?.roomScan?.rooms[index]
    const url = area?.modelId ? quote?.roomScan?.modelUrls?.[area.modelId] : undefined
    if (!area || !url) return
    openPage(viewerAddress(config.apiUrl, url, area.name)).catch(() => setNote('The 3D model could not be shown. The sizes are unaffected.'))
  }

  /**
   * Send the answers, and the price is worked out again. `asked` is the business's own questions, or
   * (T-188) the customer's, when the business answers for them. A note goes with its answer.
   */
  const sendAnswers = (asked: AppQuoteView['questions']) =>
    run(async () => {
      if (!quote) return
      const stored = await loadQuoteToken(quote.id)
      await api.answerQuestions(
        quote.id,
        asked.map((q) => {
          const note = noteToSend(questionChoices(q).choices, answers[q.id], notes[q.id])
          return { questionId: q.id, answer: (answers[q.id] ?? '').trim(), ...(note && { note }) }
        }),
        stored?.token
      )
      setAnswers({})
      setNotes({})
      setForCustomer(false)
      await load()
    })
  const confirm = () => (quote ? sendAnswers(quote.questions) : undefined)

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

  // T-202: a request that could not be priced is priced again: the dashboard's "Try again", the same
  // route, five tries a request, never counted against the plan again. The screen then follows the
  // quote as it does any quote being priced (`load` asks again until there is a price or it failed).
  // A refusal is said in the server's own sentence, and the quote is read again, so the button goes
  // when the tries are used.
  const tryAgain = async () => {
    if (!quote || busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await api.tryAgain(quote.id)
      if (alive.current) setTriedAgain(true)
    } catch (e) {
      // the tries are used: the quote read below says so in its own place, once
      if (alive.current && toApiError(e).code !== 'RETRY_LIMIT') setError(tryAgainError(e))
    }
    try {
      await load()
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const recordInvoice = (amount: number) =>
    run(async () => {
      if (!quote) return
      const saved = await api.recordFinalInvoice(quote.id, amount)
      setInvoiceSaved(saved.finalInvoiceAmount)
      setInvoice('')
    })

  // T-204: an amount under half or over double the quote is asked about before it is saved
  // (a deposit typed as the invoice, or a slipped digit). The business can still save it.
  const saveInvoice = () => {
    const amount = parseMoneyInput(invoice)
    if (!quote || amount === null) return
    const quoted = quote.pricing.total
    if (!finalInvoiceLooksOff(amount, quoted)) return void recordInvoice(amount)
    Alert.alert(
      FINAL_INVOICE_ASK,
      `${formatMoney(amount, quote.pricing.currency)} is ${amount < quoted ? 'less than half' : 'more than double'} the quote of ${formatMoney(quoted, quote.pricing.currency)}.`,
      [
        { text: 'Change the amount', style: 'cancel' },
        { text: 'Yes, save it', onPress: () => void recordInvoice(amount) },
      ]
    )
  }

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

  const { currency } = quote.pricing
  // T-186: one story: the chip and sentence (`turn`), Progress (`steps`) and the main button
  const story = storyOfQuote(quote)
  const turn = story.turn
  const steps = story.steps
  const action = mainAction(quote)
  // T-202: a request that could not be priced: "Try again" while a try is left, then the sentence that says what to do
  const tryState = tryAgainState(quote)
  // how sure the price is: the server's one sentence (the dashboard's); a server from before T-186 sends none
  const certainty = quote.pricing.certainty !== undefined ? quote.pricing.certainty : certaintySentence(quote.pricing.estimate)
  const figure = headlinePrice(quote)
  const lines = priceLines(quote)
  const sections = quote.sections ?? []
  const combined = sections.length > 0
  const customer = quote.customer ?? { name: quote.customerName, email: null, phone: null }
  const first = customerFirstName(customer.name)
  const answered = allAnswered(quote.questions, answers)
  // T-188: the customer's own open questions (a server from before T-188 sends none)
  const customerQuestions = quote.customerQuestions ?? []
  const request = quote.request
  const photos = quote.photos ?? []
  const photoCount = Math.max(quote.photoCount ?? 0, photos.length)
  const hasRequest = Boolean(request && (request.description || request.answers.length > 0 || request.address || request.postcode))
  const pricing = isPricing(quote.status)
  const sentToCustomer = action === 'share'
  const scanHere = roomScanAvailability()
  function viewPhoto(index: number) {
    setViewerPhotos(photos.map((p) => ({ id: p.id, url: p.fullUrl ?? p.url })))
    router.push(`/photo?index=${index}`)
  }

  return (
    <Screen>
      {/* T-200: an answer, a note or the final invoice being typed stays above the keyboard (ui.tsx, KeyboardSpace) */}
      <KeyboardSpace>
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
            <>
              <PricingStages stages={pricingStages({ photosTotal: photoCount, photosDone: photoCount, sent: true, status: quote.status, waitingForSignal: offline })} />
              {triedAgain ? <Muted>{TRY_AGAIN_STARTED}</Muted> : null}
            </>
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
              {/* How sure the price is: one plain sentence built from why it is not confirmed, the same as on the
                  dashboard (shared grading.ts). No grade letter, and none of the words the customer-language rules ban. */}
              {figure && certainty ? <Muted>{certainty}</Muted> : null}
              <Body style={{ marginTop: space.md }}>{turn.sentence}</Body>
              {tryState === 'used' ? <Muted>{TRY_AGAIN_USED}</Muted> : null}
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

        {/* 3. The business's own questions (T-186): a quote it made asks it, here. A question with clear
            choices is answered by pressing one; typing is behind "Other" (the shared questionChoices). */}
        {story.asksBusiness && quote.questions.length > 0 ? (
          <Card>
            <Label>{QUOTE_TURN_COPY.questions.title(quote.questions.length)}</Label>
            <Muted>{QUOTE_TURN_COPY.questions.note}</Muted>
            <Questions asked={quote.questions} answers={answers} notes={notes} onAnswer={setAnswer} onNote={(id, v) => setNotes((n) => ({ ...n, [id]: v }))} />
          </Card>
        ) : null}

        {/* 3b. T-188: a request that waits for the customer's answers. The screen says the customer was asked;
            a quiet link lets the business answer for them (after a phone call, say). Same card, same route. */}
        {!story.asksBusiness && customerQuestions.length > 0 ? (
          forCustomer ? (
            <Card>
              <Label>{QUOTE_TURN_COPY.questions.forCustomerTitle(customerQuestions.length)}</Label>
              <Muted>{QUOTE_TURN_COPY.questions.forCustomerNote}</Muted>
              <Questions asked={customerQuestions} answers={answers} notes={notes} onAnswer={setAnswer} onNote={(id, v) => setNotes((n) => ({ ...n, [id]: v }))} />
              <View style={{ height: space.lg }} />
              <Button title={QUOTE_TURN_COPY.pageButtons.giveAnswers} onPress={() => sendAnswers(customerQuestions)} busy={busy} disabled={!allAnswered(customerQuestions, answers)} />
            </Card>
          ) : (
            <Card>
              <LinkRow title={QUOTE_TURN_COPY.questions.answerForCustomer} icon="chatbubble-ellipses-outline" onPress={() => setForCustomer(true)} last />
            </Card>
          )
        ) : null}

        {/* 3c. T-193: what the room scan measured, above the price; T-194: which sizes priced it, its model in the
            web's viewer, and (until it is approved) "Scan again" and "Add an area", priced again as an answer is */}
        {quote.roomScan && quote.roomScan.rooms.length > 0 && pending ? (
          <Card>
            <Label>{pending.index === undefined ? 'New area' : 'Scanned again'}</Label>
            <Muted style={{ marginBottom: space.md }}>{SCAN_TIP}</Muted>
            <RoomScanSummary
              view={roomScanView({ version: 1, rooms: [pending.geometry] }, quote.roomScan.units.system)}
              editing={{
                names: areaNames,
                typedNames: [pending.geometry.name],
                onName: (_, name) => setPending((p) => (p ? { ...p, geometry: { ...p.geometry, name } } : p)),
                onRoomsCovered: (_, roomsCovered) => setPending((p) => (p ? { ...p, geometry: { ...p.geometry, roomsCovered } } : p)),
              }}
            />
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Button title="Use this scan" note="The quote is priced again" onPress={sendArea} busy={busy} />
              <Button
                title="Leave it as it was"
                variant="quiet"
                onPress={() => {
                  if (pending.model) removeModelFile(pending.model.uri)
                  setPending(null)
                }}
              />
            </View>
          </Card>
        ) : quote.roomScan && quote.roomScan.rooms.length > 0 ? (
          <RoomScanCard
            view={quote.roomScan}
            hasModel={(i) => {
              const id = quote.roomScan?.rooms[i]?.modelId
              return Boolean(id && quote.roomScan?.modelUrls?.[id])
            }}
            // T-200: on Android the scan is read-only: its summary and sizes, with no 3D button (the model has not
            // been seen to open there), and no "Scan again" or "Add an area" (there is no scanner)
            {...(modelOpens && { onModel: viewModel })}
            {...(quote.roomScan.canScanAgain && scanHere === 'ready' && { onScanAgain: (i: number) => void scanArea(i), onAddArea: () => void scanArea() })}
            busy={busy}
          />
        ) : null}

        {/* 4. The price: lines, the minimum as a note, added services as sections, one total */}
        {figure && (lines.length > 0 || combined) ? (
          <Card>
            <Label>{combined ? (quote.mainServiceName ?? 'Price') : 'Price'}</Label>
            {lines.map((line, i) => (
              <LineRow key={`${line.label}-${i}`} line={line} currency={currency} />
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

        {/* 6. Where it is on its way: Received, Approve and send, Opened, Accepted. Done steps are ticked
            with their date, the current one stands out, later ones are grey (T-158's steps, named in T-185). */}
        {!pricing ? (
          <Card>
            <Label>{QUOTE_TURN_COPY.tracker.title}</Label>
            {steps.map((step, i) => {
              const spoken = `${step.name}${step.date ? `, ${step.date}` : ''}${step.note ? `, ${step.note}` : ''}. ${
                step.state === 'done' ? 'Done' : step.state === 'current' ? 'This is the step now' : step.state === 'ended' ? 'Ended here' : 'Not yet'
              }`
              return (
                <View key={step.key} style={styles.step} accessible accessibilityLabel={spoken}>
                  <View style={styles.stepRail}>
                    <View
                      style={[
                        styles.stepMark,
                        step.state === 'done' && styles.stepDone,
                        step.state === 'ended' && styles.stepEnded,
                        step.state === 'current' && styles.stepCurrent,
                      ]}
                    >
                      {step.state === 'done' ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
                      {step.state === 'ended' ? <Icon name="close" size={14} color={colors.white} /> : null}
                      {step.state === 'current' ? <View style={styles.stepDot} /> : null}
                    </View>
                    {i < steps.length - 1 ? <View style={[styles.stepLine, step.state === 'done' && { backgroundColor: colors.secondary }]} /> : null}
                  </View>
                  <View style={[styles.stepWords, step.state === 'current' && styles.stepWordsCurrent]}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.stepLabel, step.state === 'later' && { color: colors.muted, fontFamily: fonts.body }, step.state === 'current' && { fontFamily: fonts.bold }]}
                        maxFontSizeMultiplier={scale.text}
                      >
                        {step.name}
                      </Text>
                      {/* "Now", or what comes first ("Answer the questions first"): the shared story's own line */}
                      {step.note ? <Muted style={{ marginTop: 0 }}>{step.note}</Muted> : null}
                    </View>
                    {step.date ? (
                      <Text style={styles.stepDate} maxFontSizeMultiplier={scale.large}>
                        {step.date}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )
            })}
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

        {/* T-198: report a problem with this estimate, and the one line that says it was reported */}
        {!pricing ? <EstimateReport quoteId={quote.id} currency={currency} /> : null}

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
          <Button title={QUOTE_TURN_COPY.pageButtons.giveAnswers} onPress={confirm} busy={busy} disabled={!answered} />
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
      ) : tryState === 'offer' ? (
        // T-202: the dashboard's button, its words and its server action; reaching the customer stays above
        <BottomBar>
          <Button title={TRY_AGAIN_BUTTON.title} icon="refresh" onPress={() => void tryAgain()} busy={busy} {...(busy && { label: TRY_AGAIN_BUTTON.busy })} />
        </BottomBar>
      ) : null}
      </KeyboardSpace>
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

/**
 * The questions of a quote, each with its choices as rows to press (typing is behind "Other") and, under
 * them, the optional note "Why (for your records)" (T-188). One text box at most (T-190): a question with no
 * choices has its answer box only, and "Other" typed replaces the note. Which choices a question has is the shared
 * rule's; the note is the business's own record and changes nothing on the quote.
 */
function Questions({
  asked,
  answers,
  notes,
  onAnswer,
  onNote,
}: {
  asked: AppQuoteView['questions']
  answers: Record<string, string | undefined>
  notes: Record<string, string>
  onAnswer: (id: string, value: string) => void
  onNote: (id: string, value: string) => void
}) {
  return (
    <>
      {asked.map((q) => {
        const words = evidenceWords(q.evidence)
        const { choices, otherLabel, numeric } = questionChoices(q)
        const answer = answers[q.id]
        const chosen = chosenChoice(choices, answer)
        const typed = isTypedAnswer(choices, answer)
        return (
          <View key={q.id} style={{ marginTop: space.lg }}>
            <Text style={styles.question} maxFontSizeMultiplier={scale.text}>
              {q.question}
            </Text>
            {words ? <Muted>{words.line}</Muted> : null}
            {words?.labelText ? <Muted>The label says: {words.labelText}</Muted> : null}
            <View style={{ height: space.sm }} />
            {choices.length > 0 ? (
              <Rows
                options={[...choices.map((c) => ({ value: c.value, label: c.label })), ...(otherLabel ? [{ value: OTHER, label: otherLabel }] : [])]}
                value={chosen ? chosen.value : typed ? OTHER : undefined}
                onChange={(v) => onAnswer(q.id, v === OTHER ? '' : v)}
              />
            ) : null}
            {typed ? (
              <View style={{ marginTop: choices.length > 0 ? space.sm : 0 }}>
                <Field label={QUOTE_TURN_COPY.questions.otherLabel} value={answer ?? ''} onChangeText={(v) => onAnswer(q.id, v)} keyboardType={numeric ? 'decimal-pad' : 'default'} />
              </View>
            ) : null}
            {/* T-190: one text box at most: the note only beside choices, and not while "Other" is typed */}
            {questionTextBox(choices, answer) === 'note' ? (
              <View style={{ marginTop: space.sm }}>
                <Field label={QUOTE_TURN_COPY.questions.noteLabel} value={notes[q.id] ?? ''} onChangeText={(v) => onNote(q.id, v.slice(0, ANSWER_NOTE_MAX))} />
                <Muted style={{ marginTop: 0 }}>{QUOTE_TURN_COPY.questions.noteHint}</Muted>
              </View>
            ) : null}
          </View>
        )
      })}
    </>
  )
}

/**
 * One price line: the business's name for it, then its detail and note, then
 * the amount. The detail ("$375 × 2 rooms") is read out of the label by the
 * shared code that writes it (T-185). The note (where the quantity came from)
 * is the server's alone, from the one shared rule, so a base fee reads the
 * same on every quote.
 */
function LineRow({ line, currency }: { line: AppQuoteLine; currency: string }) {
  const { name, detail } = lineLabelParts(line.label)
  const note = [detail, line.source].filter(Boolean).join(' · ')
  return <MoneyRow label={name} note={note || null} amount={formatMoney(line.amount, currency)} />
}

/** A service added to the quote (T-179): its own lines and subtotal, inside the one quote */
function Section({ section, currency }: { section: AppQuoteSection; currency: string }) {
  return (
    <View style={styles.section}>
      <Label>{section.serviceName}</Label>
      <Muted>{section.addedBy === 'customer' ? 'Added by the customer' : 'Added by you'}</Muted>
      {section.awaitingApproval ? <Muted>Waiting for your approval. The customer does not see this part’s price yet.</Muted> : null}
      {section.lines.map((line, i) => (
        <LineRow key={`${line.label}-${i}`} line={line} currency={currency} />
      ))}
      {minimumNote(section.minimum, currency) ? <Muted>{minimumNote(section.minimum, currency)}</Muted> : null}
      <MoneyRow label={`${section.serviceName} subtotal`} amount={formatMoney(section.subtotal, currency)} strong />
    </View>
  )
}

const styles = StyleSheet.create({
  customer: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, letterSpacing: -0.3 },
  service: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body, marginTop: 2 },
  total: { color: colors.ink, fontFamily: fonts.figureBold, fontVariant: tabular, fontSize: type.figure, marginTop: space.md },
  note: { color: colors.secondary, fontFamily: fonts.semi, fontSize: type.body, marginTop: space.md },
  question: { color: colors.ink, fontFamily: fonts.bold, fontSize: type.large },
  section: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  totals: { marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.lineStrong },
  answer: { marginTop: space.md },
  asked: { paddingVertical: space.sm },
  askedLine: { borderTopWidth: 1, borderTopColor: colors.line },
  step: { flexDirection: 'row', gap: space.md, minHeight: touch.min },
  stepRail: { alignItems: 'center', width: 24 },
  stepMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  stepEnded: { backgroundColor: colors.muted, borderColor: colors.muted },
  // the current step: a juniper ring with a dot, and its words on mint
  stepCurrent: { borderColor: colors.brand, borderWidth: 2 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 2 },
  stepWords: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingBottom: space.md, paddingTop: 2 },
  stepWordsCurrent: { backgroundColor: colors.mint, borderRadius: radius.md, paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.sm, marginBottom: space.sm, marginTop: -2 },
  stepLabel: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body },
  stepDate: { color: colors.textSecondary, fontFamily: fonts.figure, fontVariant: tabular, fontSize: type.small },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.mist, overflow: 'hidden' },
  photoImage: { width: 96, height: 96 },
  photoFailed: { alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: colors.lineStrong, borderStyle: 'dashed' },
  photoFailedText: { color: colors.textSecondary, fontFamily: fonts.semi, fontSize: type.note },
})
