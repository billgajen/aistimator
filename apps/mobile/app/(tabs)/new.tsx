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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { fieldExample, getRegion, mergeScanAnswers, roomScanView, scanAnswers, scanDifferenceLine, unitDisplayLabel, type AppBootstrapResponse } from '@qolumns/shared'
import { openPage, roomScanAvailability, roomScanBlockedLine, scanRoom } from '../../modules/room-scan'
import { useApi } from '../../src/lib/api-context'
import { fieldsForService, toApiError, type WidgetConfigResponse } from '../../src/lib/api'
import { fieldKind, isAnswered, missingRequired, optionLabel, optionValue, toSubmissionAnswers, toggleOption, visibleFields, type AppField, type RawAnswers } from '../../src/lib/answers'
import { keepPhoto, loadAreaNames, readFormCache, saveAreaNames, writeFormCache, type PickedPhoto } from '../../src/lib/device-files'
import { rememberAreaName } from '../../src/lib/area-names'
import { config } from '../../src/lib/config'
import { viewerAddress } from '../../src/lib/model-viewer'
import { plainError } from '../../src/lib/errors'
import { draftProgress, scanForRequest, type Draft, type DraftPhoto, type DraftRoom } from '../../src/lib/outbox'
import { RoomScanSummary, SCAN_TIP } from '../../src/components/RoomScanSummary'
import { useOutbox, useOutboxReady, useOutboxState } from '../../src/lib/outbox-context'
import { pricingStages } from '../../src/lib/pricing-stages'
import { onsiteGate } from '../../src/lib/onsite-gate'
import { currentUserId } from '../../src/lib/supabase'
import { PricingStages } from '../../src/components/PricingStages'
import { BottomBar, Button, EmptyState, ErrorText, Field, fieldLabel, Icon, KeyboardSpace, Label, Muted, Notice, ProgressBar, Rows, Screen, Title, TopBar } from '../../src/components/ui'
import { colors, fonts, radius, scale, space, touch, type } from '../../src/theme'

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

/**
 * T-199: the tab itself. Any business can use the app; starting a quote on site needs a plan that
 * includes it. When the server says this business cannot, the tab shows one screen and nothing is
 * started: the form (which makes a draft the moment it opens) is never mounted.
 */
export default function NewQuoteTab() {
  const api = useApi()
  const router = useRouter()
  const [boot, setBoot] = useState<Pick<AppBootstrapResponse, 'onsiteQuotes' | 'onsiteNotInPlan'> | null>(null)
  const [settled, setSettled] = useState(false)

  // T-200: Android's back button, while this tab is in front. In the form it is the form's own "Back"
  // (the step before; from the first step, the Quotes tab). Anywhere else on this tab it goes to the
  // Quotes tab. It never closes the app from here, and the unfinished quote stays saved as it is after
  // every change. (An iPhone has no such button: nothing is listening there.)
  useFocusEffect(
    useCallback(() => {
      const listening = BackHandler.addEventListener('hardwareBackPress', () => {
        if (stepBack.current) stepBack.current()
        else router.navigate('/')
        return true
      })
      return () => listening.remove()
    }, [router])
  )

  // asked each time the tab is opened, so a change of plan shows without restarting the app
  useFocusEffect(
    useCallback(() => {
      let alive = true
      const owner = currentUserId()
      ;(async () => {
        if (owner) {
          const cached = await readFormCache<FormConfig>(owner)
          if (alive && cached?.boot) setBoot((current) => current ?? cached.boot)
        }
        try {
          const live = await api.bootstrap()
          if (alive) setBoot(live)
        } catch {
          // no signal: what the phone remembers stands; with nothing remembered the form opens and the server decides
        } finally {
          if (alive) setSettled(true)
        }
      })()
      return () => {
        alive = false
      }
    }, [api])
  )

  const gate = onsiteGate(boot, settled)
  if (gate.state === 'checking') {
    return (
      <Shell title="New quote">
        <View style={styles.centre}>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading" />
        </View>
      </Shell>
    )
  }
  if (gate.state === 'closed') {
    return (
      <Shell title="New quote">
        <View style={styles.gate} testID="onsite-not-in-plan">
          <Title>{gate.words.heading}</Title>
          <Muted style={styles.gateText}>{gate.words.text}</Muted>
          <Button title={gate.words.button} onPress={() => router.navigate('/')} />
        </View>
      </Shell>
    )
  }
  return <NewQuote />
}

function NewQuote() {
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
  // T-184: the scan card is always shown where a service can use a scan; where the scan cannot run
  // (Expo Go has no scanner in it) the card says why instead of disappearing
  const scanState = useMemo(() => roomScanAvailability(), [])
  // T-194: the business's own earlier names for scanned areas, offered as quick picks
  const [areaNames, setAreaNames] = useState<string[]>([])
  useEffect(() => {
    const owner = currentUserId()
    if (owner) void loadAreaNames(owner).then(setAreaNames)
  }, [])

  // The draft: the waiting one that was tapped, or the one being written (a new one if there is none)
  const [attempt, setAttempt] = useState(0)
  const onScreen = useRef(false)
  useFocusEffect(
    useCallback(() => {
      onScreen.current = true
      return () => {
        onScreen.current = false
      }
    }, [])
  )

  // A waiting quote tapped on the Quotes tab opens here, whatever this tab was showing
  useEffect(() => {
    if (ready && params.draft && params.draft !== draftId && outbox.find(params.draft)) setDraftId(params.draft)
  }, [ready, params.draft, draftId, outbox])

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
        setLoadError(failure.offline ? OFFLINE : plainError(e, 'Your services could not be loaded. Try again.'))
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
    // this tab is ready for the next quote; the one just sent carries on as its own page
    setDraftId(null)
    router.setParams({ draft: undefined })
    // only when this tab is the one being looked at: a quote that sends itself while the trade is
    // elsewhere in the app must not pull them away (it is at the top of their quotes)
    if (sent && onScreen.current) router.push(`/quote/${sent.quoteId}?fresh=1`)
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
      <Shell title="New quote">
        <View style={styles.centre}>{draftId ? <Muted>Opening the quote…</Muted> : <ActivityIndicator color={colors.brand} accessibilityLabel="Loading" />}</View>
      </Shell>
    )
  }

  // ---- "Price this job" was pressed: it is on its way, or waiting for a signal ----
  if (draft.send !== 'editing') return <Sending draft={draft} />

  if (!form) {
    return (
      <Shell title="New quote">
        <View style={styles.centre}>
          {loadError ? (
            <ErrorText>
              {loadError === OFFLINE ? 'No signal, and this phone has not loaded your services yet. Find a signal and open this again.' : loadError}
            </ErrorText>
          ) : (
            <>
              <ActivityIndicator color={colors.brand} accessibilityLabel="Loading" />
              <Muted>Loading your services…</Muted>
            </>
          )}
        </View>
      </Shell>
    )
  }

  if (services.length === 0) {
    return (
      <Shell title="New quote">
        <EmptyState icon="construct-outline" title="No services yet" text="Add a service in your dashboard on the web. It then shows here." />
      </Shell>
    )
  }

  const angles = service?.mediaConfig.requiredAngles ?? []
  const minPhotos = service?.mediaConfig.minPhotos ?? 0
  const maxPhotos = Math.min(service?.mediaConfig.maxPhotos ?? 8, 10)
  const scanSignals = (service?.expectedSignals ?? []).filter((s) => s.scan)
  // the card shows for a service with a quantity a scan can measure, on an iPhone; it can be used when the phone can scan
  const showScan = scanSignals.length > 0 && scanState !== 'not_ios' && scanState !== 'no_lidar'
  // T-194: room scan is part of Pro and Business (a server before T-194 does not say: the scan is offered)
  const scanInPlan = form.boot.roomScan !== false
  const canScan = showScan && scanState === 'ready' && scanInPlan
  const scanBlocked = scanInPlan ? roomScanBlockedLine(scanState) : 'Room scan is part of Pro'
  // the scan as it is sent: geometry only (each room's model goes up on its own, and its id is added then)
  const scan = scanForRequest(draft.rooms, Platform.OS === 'ios' ? 'iPhone (LiDAR)' : undefined)
  // T-193: the figures in the business's own units (an app that cached the form before T-193 goes by the region)
  const unitSystem = form.boot.region.unitSystem ?? getRegion(form.boot.region.code).unitSystem
  const scanView = scan ? roomScanView(scan, unitSystem, form.boot.region.locale) : null
  // What the scan fills (the server works it out again; this is what the screen shows)
  const scanFilled = scan
    ? scanAnswers({ scan, expectedSignals: scanSignals, fields: fields.map((f) => ({ fieldId: f.fieldId })), existingAnswers: [] })
    : []
  const effective: RawAnswers = { ...Object.fromEntries(scanFilled.map((a) => [a.fieldId, String(a.value)])), ...draft.answers }
  // T-194: a number typed on site that is not what the scan measured: said, and the typed number is used
  const typedAnswers = Object.entries(draft.answers)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([fieldId, value]) => ({ fieldId, value }))
  const scanDifferences = mergeScanAnswers(typedAnswers, scanFilled).differences.map((d) => {
    const field = fields.find((f) => f.fieldId === d.fieldId)
    const signalKey = scanFilled.find((a) => a.fieldId === d.fieldId)?.signalKey
    const unit = scanSignals.find((s) => s.signalKey === signalKey)?.unit
    return { fieldId: d.fieldId, line: `${field?.label ? `${field.label}: ` : ''}${scanDifferenceLine(d, unit ? unitDisplayLabel(unit) : undefined)}` }
  })

  const hasQuestions = fields.length > 0 || showScan
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

  /** Scan a room: a new one, or (T-193 "Scan again") in place of the one at `replace` */
  async function addScannedRoom(replace?: number) {
    try {
      const { modelUri, modelSizeBytes, ...geometry } = await scanRoom()
      const rooms = draft!.rooms
      const index = replace ?? rooms.length
      const room: DraftRoom = {
        ...geometry,
        // T-194: scanned again, it keeps its name and the rooms it covers; a new area is named straight after
        name: rooms[index]?.name ?? '',
        roomsCovered: rooms[index]?.roomsCovered ?? 1,
        // T-193: the room's 3D model, when the export worked; it uploads in the background like a photo
        ...(modelUri && modelSizeBytes && modelSizeBytes > 0 && { model: { uri: modelUri, sizeBytes: Number(modelSizeBytes), state: 'waiting' as const } }),
      }
      outbox.setRooms(draft!.id, replace === undefined ? [...rooms, room] : rooms.map((r, i) => (i === replace ? room : r)))
    } catch (e) {
      // closing the scanner is not a fault; anything else is said plainly, never in the scanner's own words
      const cancelled = e instanceof Error && /cancel/i.test(e.message)
      if (!cancelled) setStepError('The scan did not finish. Try again, or type the sizes in.')
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
    else router.navigate('/')
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
    // T-194: the areas' names are offered next time
    const owner = currentUserId()
    if (owner && draft.rooms.some((r) => r.name?.trim())) {
      const names = draft.rooms.reduce((list, r) => rememberAreaName(list, r.name ?? ''), areaNames)
      setAreaNames(names)
      void saveAreaNames(owner, names)
    }
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
          setDraftId(null)
          router.setParams({ draft: undefined })
          router.navigate('/')
        },
      },
    ])
  }

  const progress = draftProgress(draft)

  return (
    <Screen>
      {/* T-184: the steps are part of the screen's own top, above the scrolling part, so nothing can sit over them */}
      <TopBar title={service?.name ?? 'New quote'}>
        <Text style={styles.stepCount} maxFontSizeMultiplier={scale.large}>
          Step {position + 1} of {stepsShown.length}
        </Text>
        <ProgressBar fraction={(position + 1) / stepsShown.length} label={`Step ${position + 1} of ${stepsShown.length}`} />
      </TopBar>
      <StepBack onBack={back} />
      <KeyboardSpace>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
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
                  // T-193: and its own rooms to scan (their model files are deleted with them)
                  if (changed && draft.rooms.length > 0) outbox.setRooms(draft.id, [])
                  outbox.update(draft.id, {
                    serviceId: id,
                    serviceName: picked?.name ?? null,
                    ...(changed && { answers: {} }),
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
                    {photo ? (
                      <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Icon name="camera-outline" color={colors.muted} />
                      </View>
                    )}
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
                  {extras.map((photo, i) => (
                    <View key={photo.id} style={styles.tile}>
                      <Image source={{ uri: photo.uri }} style={styles.tileImage} accessible accessibilityLabel={`Photo ${guided.length + i + 1}. ${photoLine(photo, offline)}`} accessibilityIgnoresInvertColors />
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
                  <ProgressBar fraction={progress.fraction} label="Photos uploaded" />
                  <Muted>{progress.line}</Muted>
                </View>
              ) : (
                <Muted>{minPhotos > 0 ? `This service needs at least ${minPhotos} photo${minPhotos === 1 ? '' : 's'}.` : 'Photos are optional for this service.'}</Muted>
              )}
              {!photosFull ? (
                <View style={{ marginTop: space.lg }}>
                  <Button title="Choose from your photos" icon="images-outline" variant="quiet" onPress={() => choosePhotos(null)} />
                </View>
              ) : (
                <Muted>That is the most photos this service takes ({maxPhotos}).</Muted>
              )}
            </>
          ) : null}

          {step === 'questions' ? (
            <>
              <Title>About the job</Title>
              {showScan ? (
                <View style={[styles.scan, !canScan && styles.scanOff]} accessible={!canScan} accessibilityLabel={!canScan ? `Room scan. ${scanBlocked}. You can still type the sizes in.` : undefined}>
                  <View style={styles.scanHead}>
                    <Icon name="scan-outline" color={canScan ? colors.brand : colors.muted} />
                    <Label>Room scan</Label>
                  </View>
                  <Muted>Walk the space with the camera: one room, a floor, or the whole house. What is scanned is measured, not estimated.</Muted>
                  {canScan ? <Muted style={{ marginTop: space.xs }}>{SCAN_TIP}</Muted> : null}
                  {!canScan ? (
                    <Text style={styles.scanBlocked} maxFontSizeMultiplier={scale.text}>
                      {scanBlocked}. You can still type the sizes in below.
                    </Text>
                  ) : null}
                  {/* T-193: what was measured, straight after the scan, so it can be checked before pricing */}
                  {scanView ? (
                    <View style={styles.scanResult}>
                      <RoomScanSummary
                        view={scanView}
                        // T-194: the model opens in the web's viewer once it is uploaded (it needs an address)
                        hasModel={(i) => draft.rooms[i]?.model?.state === 'done' && Boolean(draft.rooms[i]?.model?.modelId)}
                        actions={{
                          onModel: (i) => {
                            const modelId = draft.rooms[i]?.model?.modelId
                            if (!modelId) return
                            api
                              .modelUrl(modelId)
                              .then(({ url }) => openPage(viewerAddress(config.apiUrl, url, scanView.rooms[i]?.name ?? '')))
                              .catch(() => setStepError('The 3D model could not be shown. The sizes are kept.'))
                          },
                          ...(canScan && { onScanAgain: (i: number) => void addScannedRoom(i) }),
                          onRemove: (i) => outbox.setRooms(draft.id, draft.rooms.filter((_, r) => r !== i)),
                        }}
                        editing={{
                          names: areaNames,
                          typedNames: draft.rooms.map((r) => r.name),
                          onName: (i, name) => outbox.setRooms(draft.id, draft.rooms.map((r, n) => (n === i ? { ...r, name } : r))),
                          onRoomsCovered: (i, roomsCovered) => outbox.setRooms(draft.id, draft.rooms.map((r, n) => (n === i ? { ...r, roomsCovered } : r))),
                        }}
                        inset={space.lg * 4 + space.xs * 2}
                      />
                      {scanDifferences.map((d) => (
                        <Text key={d.fieldId} style={styles.scanBlocked} maxFontSizeMultiplier={scale.text}>
                          {`${d.line} Your number is used.`}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <View style={{ gap: space.sm, marginTop: space.md }}>
                    <Button title={draft.rooms.length ? 'Scan another area' : 'Scan an area'} icon="scan-outline" variant="secondary" disabled={!canScan} onPress={() => void addScannedRoom()} />
                    {draft.rooms.length > 1 ? <Button title="Clear the scans" variant="quiet" onPress={() => outbox.setRooms(draft.id, [])} /> : null}
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
            <Button title="Delete this quote" variant="dangerText" onPress={discard} />
          </View>
        </ScrollView>

        <BottomBar inTabs>
          {step === 'photos' ? (
            // While a photo is still needed, taking it is the main action and moving on the quieter one
            photosFull ? (
              <Button title="Next" onPress={next} />
            ) : photosShort || nextAngle ? (
              <>
                <Button title={nextAngle ? `Take photo: ${nextAngle.label}` : 'Take a photo'} icon="camera" onPress={() => takePhoto(nextAngle?.id ?? null)} />
                {photosShort ? null : <Button title="Next" variant="secondary" onPress={next} />}
              </>
            ) : (
              <>
                <Button title="Next" onPress={next} />
                <Button title="Take another photo" icon="camera-outline" variant="secondary" onPress={() => takePhoto(null)} />
              </>
            )
          ) : step === 'details' ? (
            <Button title="Price this job" onPress={priceThisJob} />
          ) : step === 'questions' ? (
            <Button title="Next" onPress={next} />
          ) : null}
          {position > 0 ? <Button title="Back" variant="quiet" onPress={back} /> : null}
        </BottomBar>
      </KeyboardSpace>
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
      placeholder={fieldExample(field)}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
      multiline={kind === 'long'}
    />
  )
}

/**
 * T-200: what Android's back button does while the form is on screen: the form's own "Back". The tab
 * (which listens for the button) and the form are two components, so the form leaves its "Back" here.
 */
const stepBack: { current: (() => void) | null } = { current: null }

function StepBack({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    stepBack.current = onBack
    return () => {
      stepBack.current = null
    }
  })
  return null
}

/** The top of this tab, for the screens that are not a step of the form */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen>
      <TopBar title={title} />
      {children}
    </Screen>
  )
}

/**
 * After "Price this job": the stages as they happen (T-184). The photos reach
 * the server, the job is sent, then its own page takes over with the same
 * list and shows the price. Leaving this screen loses nothing.
 */
function Sending({ draft }: { draft: Draft }) {
  const outbox = useOutbox()
  const router = useRouter()
  const progress = draftProgress(draft)
  const stuck = draft.problem !== null
  const stages = pricingStages({ photosTotal: progress.photosTotal, photosDone: progress.photosDone, sent: false, waitingForSignal: stuck })
  return (
    <Screen>
      <TopBar title={draft.customer.name.trim() || draft.serviceName || 'New quote'} note={draft.serviceName} />
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Title>{stuck ? 'Saved on this phone' : 'Pricing this job'}</Title>
        <PricingStages stages={stages} />
        <Muted style={{ marginTop: space.md }}>
          {stuck
            ? 'It sends by itself when the signal is back. You can leave this screen: the quote stays at the top of your quotes.'
            : 'You can leave this screen. The quote stays at the top of your quotes, and the price follows.'}
        </Muted>
      </ScrollView>
      <BottomBar inTabs>
        {stuck ? <Button title="Try now" icon="refresh" onPress={() => outbox.retryNow()} /> : null}
        <Button title="Back to quotes" variant={stuck ? 'secondary' : 'primary'} onPress={() => router.navigate('/')} />
        {draft.send === 'queued' ? <Button title="Change something" variant="quiet" onPress={() => outbox.edit(draft.id)} /> : null}
      </BottomBar>
    </Screen>
  )
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  // T-199: the "part of the plan" screen: the words in the middle, the one button under them
  gate: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  gateText: { marginTop: 0, marginBottom: space.md },
  stepCount: { color: colors.textSecondary, fontFamily: fonts.semi, fontSize: type.small, marginTop: space.sm, marginBottom: space.sm },
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
  thumbEmpty: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.field, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  angleLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: type.large },
  photoState: { color: colors.brand, fontFamily: fonts.semi, fontSize: type.body, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  tile: { width: 104 },
  tileImage: { width: 104, height: 104, borderRadius: radius.md, backgroundColor: colors.mist },
  tileState: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.note, marginTop: space.xs, minHeight: 32 },
  tileRemove: { minHeight: touch.min, justifyContent: 'center' },
  tileRemoveText: { color: colors.brand, fontFamily: fonts.semi, fontSize: type.small },
  scan: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, marginBottom: space.xl },
  scanResult: { marginTop: space.md },
  scanOff: { backgroundColor: colors.surface, borderStyle: 'dashed', borderColor: colors.lineStrong },
  scanHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scanBlocked: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, marginTop: space.sm },
  discard: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
})
