/**
 * T-198: "Report a problem with this estimate" on the app's quote screen:
 * the same choices, note and "should have been" figure as the dashboard,
 * through the same route. Once reported, the screen shows the same one line
 * ("Reported on …" with the status).
 *
 * A test estimate is marked as one by the server, from the quote itself.
 *
 * It is an extra: its list is read on its own, and if that fails the quote
 * screen reads the same without it.
 */
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { SUPPORT_COPY, type EstimateChoice } from '@qolumns/shared'
import { useApi } from '../lib/api-context'
import { plainError } from '../lib/errors'
import { done } from '../lib/feel'
import { REPORT_CHOICES, reportBody, reportProblem, reportedLine, toggleChoice, type EstimateReportItem } from '../lib/estimate-report'
import { Body, Button, Card, ErrorText, Field, Label, LinkRow, Muted, Notice, Pill, Rows, fieldLabel } from './ui'
import { space } from '../theme'

const C = SUPPORT_COPY.estimate

export function EstimateReport({ quoteId, currency }: { quoteId: string; currency: string }) {
  const api = useApi()
  const [reports, setReports] = useState<EstimateReportItem[]>([])
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<EstimateChoice[]>([])
  const [more, setMore] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReports((await api.estimateReports(quoteId)).reports ?? [])
    } catch {
      // the quote reads the same without it
    }
  }, [api, quoteId])
  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    const problem = reportProblem(chosen, more)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      const sent = await api.reportEstimate(reportBody(quoteId, chosen, more, expected))
      setThanks(sent.message ?? SUPPORT_COPY.problem.thanks)
      setOpen(false)
      setChosen([])
      setMore('')
      setExpected('')
      done()
      await load()
    } catch (thrown) {
      setError(plainError(thrown, SUPPORT_COPY.failed))
    } finally {
      setBusy(false)
    }
  }

  const reported = reportedLine(reports)
  const needsMore = chosen.includes('other')

  return (
    <Card>
      {reported ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginBottom: space.md }} accessibilityLabel={`${reported.text}. ${reported.status}`}>
          <Body>{reported.text}</Body>
          <Pill label={reported.status} tone={reported.tone} />
        </View>
      ) : null}
      {thanks && !open ? <Notice>{thanks}</Notice> : null}

      {!open ? (
        <LinkRow
          title={C.link}
          icon="flag-outline"
          onPress={() => {
            setOpen(true)
            setThanks(null)
          }}
          last
        />
      ) : (
        <View style={{ gap: space.md }}>
          <Label>{C.title}</Label>
          <Body>{C.choicesLabel}</Body>
          <Rows options={REPORT_CHOICES} value={chosen} multiple onChange={(choice) => setChosen((now) => toggleChoice(now, choice))} />
          <Field label={fieldLabel(C.more, needsMore ? 'required' : 'optional')} value={more} onChangeText={setMore} multiline maxLength={4000} />
          <Field label={fieldLabel(`${C.expected} (${currency})`, 'optional')} help={C.expectedHint} value={expected} onChangeText={setExpected} keyboardType="decimal-pad" />
          <Muted>{C.investigate}</Muted>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title={SUPPORT_COPY.problem.send} onPress={send} busy={busy} />
          <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} disabled={busy} />
        </View>
      )}
    </Card>
  )
}
