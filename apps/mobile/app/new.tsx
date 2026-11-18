/**
 * A new quote on site (T-182): service → photos → the service's questions →
 * notes and the customer's name → "Price this job".
 *
 * Built for one hand on a site visit. One thing per screen; the button that
 * moves on sits at the bottom, under the thumb; a service with one choice
 * skips its step; tapping a service moves straight on. Photos start uploading
 * the moment they are taken, while the questions are answered. Everything is
 * saved on the phone as it is typed, and "Price this job" works with no
 * signal: the quote waits and sends by itself (src/lib/outbox.ts).
 */
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { formatNumber, scanAnswers, summarizeRoomScan, type AppBootstrapResponse, type RoomScanPayload } from '@qolumns/shared'
import { isRoomScanSupported, scanRoom } from '../modules/room-scan'
import { useApi } from '../src/lib/api-context'
import { fieldsForService, toApiError, type WidgetConfigResponse } from '../src/lib/api'
import { fieldKind, isAnswered, missingRequired, optionLabel, optionValue, toSubmissionAnswers, toggleOption, visibleFields, type AppField, type RawAnswers } from '../src/lib/answers'
import { keepPhoto, readFormCache, writeFormCache, type PickedPhoto } from '../src/lib/device-files'
import { draftProgress, type Draft, type DraftPhoto } from '../src/lib/outbox'
import { useOutbox, useOutboxReady, useOutboxState } from '../src/lib/outbox-context'
import { currentUserId } from '../src/lib/supabase'
import { BottomBar, Button, ErrorText, Field, fieldLabel, Label, Muted, Notice, ProgressBar, Rows, Screen, Title } from '../src/components/ui'
import { colors, radius, space, touch, type } from '../src/theme'

const STEPS = ['service', 'photos', 'questions', 'details'] as const
type Step = (typeof STEPS)[number]

interface FormConfig {
  boot: AppBootstrapResponse
  widget: WidgetConfigResponse
}

/** The form could not be fetched because there is no signal (worded where it is shown) */
const OFFLINE = 'offline'

/** What a photo is doing, in words */
function photoLine(photo: DraftPhoto, offline: boolean): string {
  if (photo.state === 'done') return 'Uploaded'
  if (photo.state === 'uploading') return `Uploading ${Math.round(photo.progress * 100)}%`
  if (photo.state === 'refused') return photo.error ?? 'Could not be uploaded. Take it again.'
  return offline ? 'Waiting for a signal' : 'Waiting to upload'
}

export default function NewQuote() {
  const api = useApi()
  const router = useRouter()
  const outbox = useOutbox()
  const ready = useOutboxReady()
  useOutboxState() // redraw as photos upload and the draft is saved
  const params = useLocalSearchParams<{ draft?: string }>()

  const [draftId, setDraftId] = useState<string | null>(null)
  const [form, setForm] = useState<FormConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [moreDetails, setMoreDetails] = useState(false)
  const scanSupported = useMemo(() => isRoomScanSupported(), [])

  // The draft: the waiting one that was tapped, or the one being written (a new one if there is none)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!ready || draftId) return
    const draft = (params.draft && outbox.find(params.draft)) || outbox.start()
    if (draft) {
      setDraftId(draft.id)
      return
    }
    // The sign-in has not been read back yet (the app was only just opened): look again shortly
    const timer = setTimeout(() => setAttempt((n) => n + 1), 300)
    return () => clearTimeout(timer)
  }, [ready, draftId, params.draft, outbox, attempt])

  // The business's services and questions: what the phone last saw at once, then the live ones
  useEffect(() => {
    let alive = true
    const owner = currentUserId()
    ;(async () => {
      if (owner) {
        const cached = await readFormCache<FormConfig>(owner)
        if (alive && cached?.boot && cached.widget) setForm((current) => current ?? cached)
      }
      try {
        const boot = await api.bootstrap()
        const widget = await api.widgetConfig(boot.tenantKey)
        if (!alive) return
        setForm({ boot, widget })
        setLoadError(null)
        if (owner) void writeFormCache(owner, { boot, widget })
      } catch (e) {
        if (!alive) return
        const failure = toApiError(e)
        setLoadError(failure.offline ? OFFLINE : failure.message)
      }
    })()
    return () => {
      alive = false
    }
  }, [api])

  const draft = draftId ? outbox.find(draftId) : null

  // The draft became a quote: on to its page
  useEffect(() => {
    if (!draftId || draft) return
    const sent = outbox.takeSent(draftId)
    if (sent) router.replace(`/quote/${sent.quoteId}`)
  }, [draftId, draft, outbox, router])

  const services = form?.widget.services ?? []
  const service = services.find((s) => s.id === draft?.serviceId)
  const fields = useMemo(
    () => (form && draft?.serviceId ? visibleFields(fieldsForService(form.widget, draft.serviceId)) : []),
    [form, draft?.serviceId]
  )

  // One service: there is nothing to pick
  useEffect(() => {
    if (!draft || draft.serviceId || services.length !== 1) return
    const only = services[0]!
    outbox.update(draft.id, { serviceId: only.id, serviceName: only.name, step: Math.max(draft.step, 1) })
  }, [draft, services, outbox])

  if (!draft) {
    return (
      <Screen>
        <View style={styles.centre}>{draftId ? <Muted>Opening the quote…</Muted> : <ActivityIndicator color={colors.brand} />}</View>
      </Screen>
    )
  }

  // ---- "Price this job" was pressed: it is on its way, or waiting for a signal ----
  if (draft.send !== 'editing') return <Sending draft={draft} />

  if (!form) {
    return (
      <Screen>
        <View style={styles.centre}>
          {loadError ? (
            <ErrorText>
              {loadError === OFFLINE ? 'No signal, and this phone has not loaded your services yet. Find a signal and open this again.' : loadError}
            </ErrorText>
          ) : (
            <>
              <ActivityIndicator color={colors.brand} />
              <Muted>Loading your services…</Muted>
            </>
          )}
        </View>
      </Screen>
    )
  }

  if (services.length === 0) {
    return (
      <Screen>
        <View style={styles.centre}>
          <Title>No services yet</Title>
          <Muted>Add a service in your dashboard on the web. It then shows here.</Muted>
        </View>
      </Screen>
    )
  }

  const angles = service?.mediaConfig.requiredAngles ?? []
  const minPhotos = service?.mediaConfig.minPhotos ?? 0
  const maxPhotos = Math.min(service?.mediaConfig.maxPhotos ?? 8, 10)
  const scanSignals = (service?.expectedSignals ?? []).filter((s) => s.scan)
  const canScan = scanSupported && scanSignals.length > 0
  const scan: RoomScanPayload | null =
    draft.rooms.length > 0 ? { version: 1, rooms: draft.rooms, device: Platform.OS === 'ios' ? 'iPhone (LiDAR)' : undefined } : null
  // What the scan fills (the server works it out again; this is what the screen shows)
  const scanFilled = scan
    ? scanAnswers({ scan, expectedSignals: scanSignals, fields: fields.map((f) => ({ fieldId: f.fieldId })), existingAnswers: [] })
    : []
  const effective: RawAnswers = { ...Object.fromEntries(scanFilled.map((a) => [a.fieldId, String(a.value)])), ...draft.answers }

  const hasQuestions = fields.length > 0 || canScan
  const stepsShown: Step[] = STEPS.filter((s) => (s === 'service' ? services.length > 1 : s === 'questions' ? hasQuestions : true))
  const step: Step = stepsShown.includes(STEPS[draft.step] ?? 'service') ? (STEPS[draft.step] ?? 'service') : (stepsShown[0] ?? 'details')
  const position = stepsShown.indexOf(step)
  const offline = draft.problem?.kind === 'offline'

  const goTo = (next: Step) => {
    setStepError(null)
    outbox.update(draft.id, { step: STEPS.indexOf(next) })
  }
  const setAnswer = (fieldId: string, value: RawAnswers[string]) => outbox.update(draft.id, { answers: { ...draft.answers, [fieldId]: value } })

  // Guided angles first and in order: triage reads only the first few photos, and packs put the rating plate first
  const guided = angles.map((a) => draft.photos.find((p) => p.angleId === a.id)).filter((p): p is DraftPhoto => Boolean(p))
  const extras = draft.photos.filter((p) => !p.angleId || !angles.some((a) => a.id === p.angleId))
  const ordered = [...guided, ...extras]
  const nextAngle = angles.find((a) => !draft.photos.some((p) => p.angleId === a.id))
  const photosShort = ordered.length < minPhotos
  const photosFull = ordered.length >= maxPhotos

  async function addPicked(picked: PickedPhoto[], angleId: string | null) {
    for (const [index, asset] of picked.entries()) {
      try {
        // only the first of several can answer a guided angle; the rest are extras
        outbox.addPhoto(draft!.id, await keepPhoto(asset, index === 0 ? angleId : null))
      } catch {
        setStepError('That photo could not be saved on this phone. Try again.')
      }
    }
  }

  async function takePhoto(angleId: string | null) {
    setStepError(null)
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return choosePhotos(angleId)
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, exif: false })
    if (!result.canceled) await addPicked(result.assets.slice(0, 1), angleId)
  }

  async function choosePhotos(angleId: string | null) {
    setStepError(null)
    const room = Math.max(1, maxPhotos - ordered.length)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      exif: false,
      allowsMultipleSelection: !angleId && room > 1,
      selectionLimit: angleId ? 1 : room,
    })
    if (!result.canceled) await addPicked(result.assets.slice(0, room), angleId)
  }

  async function addScannedRoom() {
    try {
      const room = await scanRoom()
      outbox.update(draft!.id, { rooms: [...draft!.rooms, { ...room, name: `Room ${draft!.rooms.length + 1}` }] })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The scan did not finish'
      if (!/cancel/i.test(message)) setStepError(message)
    }
  }

  function next() {
    if (step === 'photos' && photosShort) {
      setStepError(`Take at least ${minPhotos} photo${minPhotos === 1 ? '' : 's'}.`)
      return
    }
    if (step === 'questions') {
      const missing = missingRequired(fields, effective)
      if (missing.length > 0) {
        setStepError(`Still needed: ${missing.join(', ')}`)
        return
      }
    }
    const following = stepsShown[position + 1]
    if (following) goTo(following)
  }

  function back() {
    const previous = stepsShown[position - 1]
    if (previous) goTo(previous)
    else router.back()
  }

  function priceThisJob() {
    if (!draft || !draft.serviceId) return
    const name = draft.customer.name.trim()
    const email = draft.customer.email.trim()
    // An unfinished quote can be opened straight on this step: what the earlier steps check is checked again
    if (photosShort) {
      goTo('photos')
      setStepError(`Take at least ${minPhotos} photo${minPhotos === 1 ? '' : 's'}.`)
      return
    }
    const missing = missingRequired(fields, effective)
    if (missing.length > 0 && hasQuestions) {
      goTo('questions')
      setStepError(`Still needed: ${missing.join(', ')}`)
      return
    }
    if (!name) {
      setStepError("Add the customer's name.")
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStepError('That email address does not look right.')
      return
    }
    setStepError(null)
    outbox.queue(
      draft.id,
      {
        serviceId: draft.serviceId,
        customer: { name, ...(email && { email }), ...(draft.customer.phone.trim() && { phone: draft.customer.phone.trim() }) },
        job: {
          ...(draft.address.trim() && { address: draft.address.trim() }),
          ...(draft.postcode.trim() && { postcodeOrZip: draft.postcode.trim() }),
          // Typed values only: the server fills scanned quantities itself
          answers: toSubmissionAnswers(fields, draft.answers, draft.description),
        },
        ...(scan && { scan }),
      },
      ordered.map((p) => p.id)
    )
  }

  function discard() {
    Alert.alert('Delete this quote?', 'The photos and answers on this phone are removed. Nothing has been sent.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          outbox.discard(draft!.id)
          router.back()
        },
      },
    ])
  }

  const progress = draftProgress(draft)

  return (
    <Screen>
      <Stack.Screen options={{ title: service?.name ?? 'New quote' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepCount}>
            Step {position + 1} of {stepsShown.length}
          </Text>
          <ProgressBar fraction={(position + 1) / stepsShown.length} />
          <View style={{ height: space.lg }} />

          {draft.problem?.kind === 'refused' ? <Notice tone="danger">{draft.problem.message}</Notice> : null}
          {loadError && position === 0 ? (
            <Notice>{loadError === OFFLINE ? 'No signal. Using your services as this phone last saw them.' : loadError}</Notice>
          ) : null}

          {step === 'service' ? (
            <>
              <Title>Which service?</Title>
              <Rows
                options={services.map((s) => ({ value: s.id, label: s.name }))}
                value={draft.serviceId ?? undefined}
                onChange={(id) => {
                  const picked = services.find((s) => s.id === id)
                  // another service has other questions and other photos to take
                  const changed = draft.serviceId !== null && draft.serviceId !== id
                  if (changed) for (const photo of draft.photos) outbox.removePhoto(draft.id, photo.id)
                  outbox.update(draft.id, {
                    serviceId: id,
                    serviceName: picked?.name ?? null,
                    ...(changed && { answers: {}, rooms: [] }),
                    step: STEPS.indexOf('photos'),
                  })
                  setStepError(null)
                }}
              />
            </>
          ) : null}

          {step === 'photos' ? (
            <>
              <Title>Photos</Title>
              {service?.mediaConfig.photoGuidance ? <Muted style={{ marginBottom: space.md }}>{service.mediaConfig.photoGuidance}</Muted> : null}
              {angles.map((angle) => {
                const photo = draft.photos.find((p) => p.angleId === angle.id)
                return (
                  <Pressable
                    key={angle.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${angle.label}. ${photo ? photoLine(photo, offline) : 'Take photo'}`}
                    onPress={() => takePhoto(angle.id)}
                    style={({ pressed }) => [styles.angle, pressed && { backgroundColor: colors.mint }]}
                  >
                    {photo ? <Image source={{ uri: photo.uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.angleLabel}>{angle.label}</Text>
                      {angle.guidance ? <Muted>{angle.guidance}</Muted> : null}
                      <Text style={[styles.photoState, photo?.state === 'refused' && { color: colors.danger }]}>
                        {photo ? `${photoLine(photo, offline)} · Take again` : 'Take photo'}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
              {extras.length > 0 ? (
                <View style={styles.grid}>
                  {extras.map((photo) => (
                    <View key={photo.id} style={styles.tile}>
                      <Image source={{ uri: photo.uri }} style={styles.tileImage} />
                      <Text style={[styles.tileState, photo.state === 'refused' && { color: colors.danger }]} numberOfLines={2}>
                        {photoLine(photo, offline)}
                      </Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Remove this photo" onPress={() => outbox.removePhoto(draft.id, photo.id)} style={styles.tileRemove}>
                        <Text style={styles.tileRemoveText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              {ordered.length > 0 ? (
                <View style={{ marginTop: space.md }}>
                  <ProgressBar fraction={progress.fraction} />
                  <Muted>{progress.line}</Muted>
                </View>
              ) : (
                <Muted>{minPhotos > 0 ? `This service needs at least ${minPhotos} photo${minPhotos === 1 ? '' : 's'}.` : 'Photos are optional for this service.'}</Muted>
              )}
              {!photosFull ? (
                <View style={{ marginTop: space.lg }}>
                  <Button title="Choose from your photos" variant="quiet" onPress={() => choosePhotos(null)} />
                </View>
              ) : (
                <Muted>That is the most photos this service takes ({maxPhotos}).</Muted>
              )}
            </>
          ) : null}

          {step === 'questions' ? (
            <>
              <Title>About the job</Title>
              {canScan ? (
                <View style={styles.scan}>
                  <Label>Room scan</Label>
                  <Muted>Walk each room with the camera. A scanned room is measured, not estimated.</Muted>
                  {scan ? (
                    <Text style={styles.scanSummary}>
                      {(() => {
                        const s = summarizeRoomScan(scan)
                        return `${s.rooms} room${s.rooms === 1 ? '' : 's'} · ${formatNumber(s.wallAreaNetSqm)} m² walls · ${formatNumber(s.floorAreaSqm)} m² floor`
                      })()}
                    </Text>
                  ) : null}
                  <View style={{ gap: space.sm, marginTop: space.md }}>
                    <Button title={draft.rooms.length ? 'Scan another room' : 'Scan a room'} variant="secondary" onPress={addScannedRoom} />
                    {draft.rooms.length > 0 ? <Button title="Clear the scans" variant="quiet" onPress={() => outbox.update(draft.id, { rooms: [] })} /> : null}
                  </View>
                </View>
              ) : null}
              {fields.map((field) => (
                <Question key={field.fieldId} field={field} value={effective[field.fieldId]} onChange={(value) => setAnswer(field.fieldId, value)} />
              ))}
            </>
          ) : null}

          {step === 'details' ? (
            <>
              <Title>Last details</Title>
              <Field
                label={fieldLabel("Customer's name", 'required')}
                value={draft.customer.name}
                onChangeText={(name) => outbox.update(draft.id, { customer: { ...draft.customer, name } })}
                autoComplete="name"
                autoCapitalize="words"
                returnKeyType="done"
              />
              <Field
                label={fieldLabel('Notes about the job', 'optional')}
                help="Anything the photos and answers do not show."
                value={draft.description}
                onChangeText={(description) => outbox.update(draft.id, { description })}
                multiline
              />
              {moreDetails || draft.customer.email || draft.customer.phone || draft.address || draft.postcode ? (
                <>
                  <Field
                    label={fieldLabel('Email', 'optional')}
                    help="With an email address, the customer is also emailed their link."
                    value={draft.customer.email}
                    onChangeText={(email) => outbox.update(draft.id, { customer: { ...draft.customer, email } })}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  <Field
                    label={fieldLabel('Phone', 'optional')}
                    value={draft.customer.phone}
                    onChangeText={(phone) => outbox.update(draft.id, { customer: { ...draft.customer, phone } })}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                  <Field label={fieldLabel('Job address', 'optional')} value={draft.address} onChangeText={(address) => outbox.update(draft.id, { address })} />
                  <Field
                    label={fieldLabel(form.boot.region.postalCodeLabel, 'optional')}
                    value={draft.postcode}
                    onChangeText={(postcode) => outbox.update(draft.id, { postcode })}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </>
              ) : (
                <Button title="Add email, phone or address" variant="quiet" onPress={() => setMoreDetails(true)} />
              )}
              <Muted style={{ marginTop: space.md }}>
                You see the price first. The customer gets their link when you approve it.
              </Muted>
              {progress.photosTotal > 0 && progress.photosDone < progress.photosTotal ? <Muted>{progress.line}</Muted> : null}
            </>
          ) : null}

          {stepError ? <ErrorText>{stepError}</ErrorText> : null}

          <View style={styles.discard}>
            <Button title="Delete this quote" variant="quiet" onPress={discard} />
          </View>
        </ScrollView>

        <BottomBar>
          {step === 'photos' ? (
            // While a photo is still needed, taking it is the main action and moving on the quieter one
            photosFull ? (
              <Button title="Next" onPress={next} />
            ) : photosShort || nextAngle ? (
              <>
                <Button title={nextAngle ? `Take photo: ${nextAngle.label}` : 'Take a photo'} onPress={() => takePhoto(nextAngle?.id ?? null)} />
                {photosShort ? null : <Button title="Next" variant="secondary" onPress={next} />}
              </>
            ) : (
              <>
                <Button title="Next" onPress={next} />
                <Button title="Take another photo" variant="secondary" onPress={() => takePhoto(null)} />
              </>
            )
          ) : step === 'details' ? (
            <Button title="Price this job" onPress={priceThisJob} />
          ) : step === 'questions' ? (
            <Button title="Next" onPress={next} />
          ) : null}
          {position > 0 ? <Button title="Back" variant="quiet" onPress={back} /> : null}
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  )
}

/** One of the service's own questions, asked the way the website form asks it */
function Question({ field, value, onChange }: { field: AppField; value: RawAnswers[string]; onChange: (value: RawAnswers[string]) => void }) {
  const kind = fieldKind(field)
  const label = fieldLabel(field.label, field.required || field.criticalForPricing ? 'required' : undefined)
  if (kind === 'choice' || kind === 'multi' || kind === 'yesno') {
    const options =
      kind === 'yesno'
        ? [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]
        : (field.options ?? []).map((o) => ({ value: optionValue(o), label: optionLabel(o) }))
    const current = kind === 'multi' ? (Array.isArray(value) ? value : []) : kind === 'yesno' ? (isAnswered(field, value) ? String(value === true || value === 'true') : undefined) : typeof value === 'string' ? value : undefined
    return (
      <View style={{ marginBottom: space.xl }}>
        <Label>{label}</Label>
        {kind === 'multi' ? <Muted style={{ marginBottom: space.sm }}>Choose all that apply.</Muted> : null}
        <Rows
          options={options}
          value={current}
          multiple={kind === 'multi'}
          onChange={(v) => onChange(kind === 'multi' ? toggleOption(value, v) : kind === 'yesno' ? v === 'true' : v)}
        />
        {field.helpText ? <Muted>{field.helpText}</Muted> : null}
      </View>
    )
  }
  return (
    <Field
      label={label}
      help={field.helpText}
      placeholder={field.placeholder}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
      multiline={kind === 'long'}
    />
  )
}

/** After "Price this job": uploading, sending, or waiting for a signal. Leaving this screen loses nothing. */
function Sending({ draft }: { draft: Draft }) {
  const outbox = useOutbox()
  const router = useRouter()
  const progress = draftProgress(draft)
  const stuck = draft.problem !== null
  return (
    <Screen>
      <Stack.Screen options={{ title: draft.serviceName ?? 'New quote' }} />
      <View style={styles.sending}>
        <Title>{stuck ? 'Saved on this phone' : 'Sending the job'}</Title>
        <ProgressBar fraction={draft.send === 'sending' ? 1 : progress.fraction * 0.9} />
        <Text style={styles.sendingLine}>{progress.line}</Text>
        {!stuck ? <ActivityIndicator color={colors.brand} style={{ marginTop: space.lg }} /> : null}
        <Muted style={{ marginTop: space.lg }}>
          You can leave this screen. The quote stays at the top of your quotes until it has been sent, and the price follows.
        </Muted>
      </View>
      <BottomBar>
        {stuck ? <Button title="Try now" onPress={() => outbox.retryNow()} /> : null}
        <Button title="Back to quotes" variant={stuck ? 'secondary' : 'primary'} onPress={() => router.replace('/')} />
        {draft.send === 'queued' ? <Button title="Change something" variant="quiet" onPress={() => outbox.edit(draft.id)} /> : null}
      </BottomBar>
    </Screen>
  )
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  stepCount: { color: colors.muted, fontSize: type.small, marginBottom: space.sm },
  angle: {
    minHeight: touch.row,
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  thumbEmpty: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.field, borderStyle: 'dashed' },
  angleLabel: { color: colors.ink, fontWeight: '700', fontSize: type.large },
  photoState: { color: colors.brand, fontWeight: '600', fontSize: type.body, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  tile: { width: 104 },
  tileImage: { width: 104, height: 104, borderRadius: radius.md, backgroundColor: colors.mist },
  tileState: { color: colors.textSecondary, fontSize: type.note, marginTop: space.xs, minHeight: 32 },
  tileRemove: { minHeight: touch.min, justifyContent: 'center' },
  tileRemoveText: { color: colors.brand, fontWeight: '600', fontSize: type.small },
  scan: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, marginBottom: space.xl },
  // butter is for measurement, and a scan's result is one
  scanSummary: { color: colors.ink, fontVariant: ['tabular-nums'], marginTop: space.sm, backgroundColor: colors.butter, padding: space.sm, borderRadius: radius.md },
  discard: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  sending: { flex: 1, justifyContent: 'center', padding: space.xl },
  sendingLine: { color: colors.ink, fontSize: type.large, marginTop: space.md },
})
