import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { formatMoney, parseMoneyInput, type AppQuoteView } from '@estimator/shared'
import { useApi } from '../../src/lib/api-context'
import { headlinePrice, isPricing, statusLabel } from '../../src/lib/price'
import { loadQuoteToken } from '../../src/lib/quote-tokens'
import { Button, Card, Choice, ErrorText, Field, Label, Muted, Screen } from '../../src/components/ui'
import { colors, radius, space } from '../../src/theme'

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const [quote, setQuote] = useState<AppQuoteView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [invoice, setInvoice] = useState('')
  const [invoiceSaved, setInvoiceSaved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const q = await api.getQuote(id)
      setQuote(q)
      // Keep polling while the worker prices (first price ~20–60 s)
      if (isPricing(q.status)) timer.current = setTimeout(load, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the quote')
    }
  }, [api, id])

  useEffect(() => {
    load()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  async function confirm() {
    if (!quote) return
    setBusy(true)
    setError(null)
    try {
      const stored = await loadQuoteToken(quote.id)
      await api.answerQuestions(
        quote.id,
        quote.questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? (q.aiValue !== undefined ? String(q.aiValue) : '') })),
        stored?.token
      )
      setAnswers({})
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the answers')
    } finally {
      setBusy(false)
    }
  }

  async function saveInvoice() {
    const amount = parseMoneyInput(invoice)
    if (!quote || amount === null) return
    setBusy(true)
    setError(null)
    try {
      const saved = await api.recordFinalInvoice(quote.id, amount)
      setInvoiceSaved(saved.finalInvoiceAmount)
      setInvoice('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice')
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    const stored = quote ? await loadQuoteToken(quote.id) : null
    if (!stored) {
      setError('This quote was created on another device. Share it from the dashboard.')
      return
    }
    await Share.share({ message: `Your estimate from ${quote?.businessName ?? 'us'}: ${stored.viewUrl}` })
  }

  if (!quote) {
    return (
      <Screen>
        <View style={{ padding: space.lg }}>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</View>
      </Screen>
    )
  }

  const { estimate, currency } = quote.pricing
  const allAnswered = quote.questions.every((q) => (answers[q.id] ?? (q.aiValue !== undefined ? String(q.aiValue) : '')).trim() !== '')

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={styles.instrument}>
          <Text style={styles.status}>{statusLabel(quote.status)}</Text>
          <Text style={styles.total}>{headlinePrice(quote)}</Text>
          {estimate ? (
            <Text style={styles.grade}>
              Grade {estimate.grade} · {estimate.label}
            </Text>
          ) : null}
        </View>

        <Card>
          <Label>{quote.customerName}</Label>
          <Muted>{quote.serviceName}</Muted>
        </Card>

        {quote.questions.length > 0 && quote.status === 'awaiting_clarification' ? (
          <Card>
            <Label>Confirm on site</Label>
            <Muted>Your answer is treated as confirmed and fixes the price.</Muted>
            {quote.questions.map((q) => (
              <View key={q.id} style={{ marginTop: space.md }}>
                <Text style={styles.question}>{q.question}</Text>
                {q.evidence ? <Muted>{q.evidence}</Muted> : null}
                {q.options && q.options.length > 0 ? (
                  <Choice
                    options={q.options.map((o) => ({ value: o, label: o }))}
                    value={answers[q.id] ?? (q.aiValue !== undefined ? String(q.aiValue) : undefined)}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  />
                ) : (
                  <Field
                    label={q.aiValue !== undefined ? `Measured: ${q.aiValue}` : 'Answer'}
                    value={answers[q.id] ?? (q.aiValue !== undefined ? String(q.aiValue) : '')}
                    onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                    keyboardType={typeof q.aiValue === 'number' ? 'decimal-pad' : 'default'}
                  />
                )}
              </View>
            ))}
            <Button title="Confirm and reprice" onPress={confirm} busy={busy} disabled={!allAnswered} />
          </Card>
        ) : null}

        {quote.takeoff.length > 0 ? (
          <Card>
            <Label>Measurement & takeoff</Label>
            {quote.takeoff.map((t, i) => (
              <View key={i} style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineItem}>{t.item}</Text>
                  <Muted>{t.method}</Muted>
                </View>
                <Text style={styles.lineAmount}>{formatMoney(t.amount, currency)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {!isPricing(quote.status) && quote.status !== 'awaiting_clarification' ? (
          <Button title="Share quote link" variant="secondary" onPress={share} />
        ) : null}

        {['accepted', 'paid', 'sent', 'viewed'].includes(quote.status) ? (
          <Card>
            <Label>Final invoice</Label>
            <Muted>What you finally charged. It measures how close your estimates are.</Muted>
            {invoiceSaved !== null ? <Text style={styles.lineItem}>Saved: {formatMoney(invoiceSaved, currency)}</Text> : null}
            <Field label={`Invoiced amount (${currency})`} value={invoice} onChangeText={setInvoice} keyboardType="decimal-pad" />
            <Button title="Save final invoice" onPress={saveInvoice} busy={busy} disabled={parseMoneyInput(invoice) === null} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  instrument: { backgroundColor: colors.brand, borderRadius: radius.lg, padding: space.xl, marginBottom: space.md },
  status: { color: colors.mint, fontWeight: '600' },
  total: { color: colors.white, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'], marginVertical: space.sm },
  grade: { color: colors.butter, fontWeight: '600' },
  question: { color: colors.ink, fontWeight: '600', marginBottom: space.xs },
  line: { flexDirection: 'row', paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  lineItem: { color: colors.ink, fontWeight: '600' },
  lineAmount: { color: colors.ink, fontVariant: ['tabular-nums'] },
})
