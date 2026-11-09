import { useEffect, useMemo, useState } from 'react'
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { formatNumber, scanAnswers, summarizeRoomScan, type AppBootstrapResponse, type RoomScanPayload, type RoomScanRoom } from '@estimator/shared'
import { isRoomScanSupported, scanRoom } from '../modules/room-scan'
import { useApi } from '../src/lib/api-context'
import { fieldsForService, type PhotoFile, type WidgetConfigResponse } from '../src/lib/api'
import { missingRequired, optionLabel, optionValue, toSubmissionAnswers, visibleFields, type RawAnswers } from '../src/lib/answers'
import { saveQuoteToken } from '../src/lib/quote-tokens'
import { Button, Card, Choice, ErrorText, Field, Label, Muted, Screen } from '../src/components/ui'
import { colors, radius, space } from '../src/theme'

interface Shot extends PhotoFile {
  angleId: string | null
}

export default function NewQuote() {
  const api = useApi()
  const router = useRouter()
  const [boot, setBoot] = useState<AppBootstrapResponse | null>(null)
  const [widget, setWidget] = useState<WidgetConfigResponse | null>(null)
  const [serviceId, setServiceId] = useState<string | undefined>()
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' })
  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [description, setDescription] = useState('')
  const [raw, setRaw] = useState<RawAnswers>({})
  const [shots, setShots] = useState<Shot[]>([])
  // T-138: rooms scanned with LiDAR on this quote
  const [rooms, setRooms] = useState<RoomScanRoom[]>([])
  const scanSupported = useMemo(() => isRoomScanSupported(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const b = await api.bootstrap()
        setBoot(b)
        setWidget(await api.widgetConfig(b.tenantKey))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your services')
      }
    })()
  }, [api])

  const service = widget?.services.find((s) => s.id === serviceId)
  const fields = useMemo(() => (widget && serviceId ? visibleFields(fieldsForService(widget, serviceId)) : []), [widget, serviceId])
  const angles = service?.mediaConfig.requiredAngles ?? []
  const scanSignals = (service?.expectedSignals ?? []).filter((s) => s.scan)
  const scan: RoomScanPayload | null = rooms.length > 0 ? { version: 1, rooms, device: Platform.OS === 'ios' ? 'iPhone (LiDAR)' : undefined } : null
  // What the scan fills (the server recomputes; this is the on-screen preview)
  const scanFilled = scan
    ? scanAnswers({ scan, expectedSignals: scanSignals, fields: fields.map((f) => ({ fieldId: f.fieldId })), existingAnswers: [] })
    : []
  const effectiveRaw: RawAnswers = { ...Object.fromEntries(scanFilled.map((a) => [a.fieldId, String(a.value)])), ...raw }

  async function addScannedRoom() {
    try {
      const room = await scanRoom()
      setRooms((prev) => [...prev, { ...room, name: `Room ${prev.length + 1}` }])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Scan failed'
      if (!/cancel/i.test(message)) setError(message)
    }
  }

  async function takePhoto(angleId: string | null) {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    const result = permission.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, exif: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] })
    if (result.canceled || !result.assets[0]) return
    const a = result.assets[0]
    const shot: Shot = {
      uri: a.uri,
      fileName: a.fileName ?? `photo-${Date.now()}.jpg`,
      contentType: a.mimeType ?? 'image/jpeg',
      sizeBytes: a.fileSize ?? 0,
      angleId,
    }
    // One photo per guided angle (retake replaces); extras append
    setShots((prev) => (angleId ? [...prev.filter((s) => s.angleId !== angleId), shot] : [...prev, shot]))
  }

  // Guided angles first and in order: triage reads only the first few photos,
  // and packs put the rating plate first
  const orderedShots = useMemo(() => {
    const byAngle = angles.map((a) => shots.find((s) => s.angleId === a.id)).filter((s): s is Shot => Boolean(s))
    return [...byAngle, ...shots.filter((s) => !s.angleId)]
  }, [angles, shots])

  const missing = missingRequired(fields, effectiveRaw)
  const minPhotos = service?.mediaConfig.minPhotos ?? 0
  const canSubmit =
    Boolean(serviceId && customer.name.trim() && customer.email.trim()) && missing.length === 0 && orderedShots.length >= minPhotos

  async function submit() {
    if (!boot || !serviceId) return
    setBusy(true)
    setError(null)
    try {
      const assetIds = await api.uploadPhotos(boot.tenantKey, orderedShots)
      const created = await api.createQuote({
        serviceId,
        customer: { name: customer.name.trim(), email: customer.email.trim(), ...(customer.phone.trim() && { phone: customer.phone.trim() }) },
        job: {
          ...(address.trim() && { address: address.trim() }),
          ...(postcode.trim() && { postcodeOrZip: postcode.trim() }),
          // Typed values only: the server fills scanned quantities itself
          answers: toSubmissionAnswers(fields, raw, description),
        },
        assetIds,
        ...(scan && { scan }),
      })
      await saveQuoteToken(created.quoteId, created.quoteViewUrl)
      router.replace(`/quote/${created.quoteId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the quote')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        {error ? <ErrorText>{error}</ErrorText> : null}

        <Card>
          <Label>Service</Label>
          {widget ? (
            <Choice options={widget.services.map((s) => ({ value: s.id, label: s.name }))} value={serviceId} onChange={(id) => { setServiceId(id); setRaw({}); setShots([]) }} />
          ) : (
            <Muted>Loading your services…</Muted>
          )}
        </Card>

        <Card>
          <Field label="Customer name" value={customer.name} onChangeText={(name) => setCustomer((c) => ({ ...c, name }))} autoComplete="name" />
          <Field label="Customer email" help="Their quote link is emailed here" value={customer.email} onChangeText={(email) => setCustomer((c) => ({ ...c, email }))} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Customer phone (optional)" value={customer.phone} onChangeText={(phone) => setCustomer((c) => ({ ...c, phone }))} keyboardType="phone-pad" />
          <Field label="Job address (optional)" value={address} onChangeText={setAddress} />
          <Field label={boot?.region.postalCodeLabel ?? 'Postcode'} value={postcode} onChangeText={setPostcode} autoCapitalize="characters" />
        </Card>

        {service ? (
          <>
            <Card>
              <Label>Photos</Label>
              {service.mediaConfig.photoGuidance ? <Muted>{service.mediaConfig.photoGuidance}</Muted> : null}
              {angles.map((angle) => {
                const shot = shots.find((s) => s.angleId === angle.id)
                return (
                  <Pressable key={angle.id} onPress={() => takePhoto(angle.id)} style={styles.angle}>
                    {shot ? <Image source={{ uri: shot.uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.angleLabel}>{angle.label}</Text>
                      {angle.guidance ? <Muted>{angle.guidance}</Muted> : null}
                      <Text style={styles.link}>{shot ? 'Retake' : 'Take photo'}</Text>
                    </View>
                  </Pressable>
                )
              })}
              <Button title="Add another photo" variant="secondary" onPress={() => takePhoto(null)} />
            </Card>

            {scanSupported && scanSignals.length > 0 ? (
              <Card>
                <Label>Room scan (LiDAR)</Label>
                <Muted>Walk each room with the camera. Scanned quantities are exact, so the quote can be Grade A.</Muted>
                {scan ? (
                  <Text style={styles.scanSummary}>
                    {(() => {
                      const s = summarizeRoomScan(scan)
                      return `${s.rooms} room${s.rooms === 1 ? '' : 's'} · ${formatNumber(s.wallAreaNetSqm)} m² walls · ${formatNumber(s.floorAreaSqm)} m² floor`
                    })()}
                  </Text>
                ) : null}
                <Button title={rooms.length ? 'Scan another room' : 'Scan a room'} variant="secondary" onPress={addScannedRoom} />
                {rooms.length > 0 ? <Button title="Clear scans" variant="secondary" onPress={() => setRooms([])} /> : null}
              </Card>
            ) : null}

            <Card>
              <Field label="What's the job?" value={description} onChangeText={setDescription} multiline style={{ minHeight: 80 }} />
              {fields.map((field) =>
                field.options && field.options.length > 0 ? (
                  <View key={field.fieldId} style={{ marginBottom: space.md }}>
                    <Label>{field.label}</Label>
                    <Choice
                      options={field.options.map((o) => ({ value: optionValue(o), label: optionLabel(o) }))}
                      value={typeof raw[field.fieldId] === 'string' ? (raw[field.fieldId] as string) : undefined}
                      onChange={(v) => setRaw((r) => ({ ...r, [field.fieldId]: v }))}
                    />
                    {field.helpText ? <Muted>{field.helpText}</Muted> : null}
                  </View>
                ) : (
                  <Field
                    key={field.fieldId}
                    label={field.label}
                    help={field.helpText}
                    value={typeof effectiveRaw[field.fieldId] === 'string' ? (effectiveRaw[field.fieldId] as string) : ''}
                    onChangeText={(v) => setRaw((r) => ({ ...r, [field.fieldId]: v }))}
                    keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
                  />
                )
              )}
            </Card>
          </>
        ) : null}

        {missing.length > 0 ? <Muted>Still needed: {missing.join(', ')}</Muted> : null}
        {service && orderedShots.length < minPhotos ? <Muted>Take at least {minPhotos} photo{minPhotos > 1 ? 's' : ''}.</Muted> : null}
        <Button title="Price this job" onPress={submit} busy={busy} disabled={!canSubmit} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  angle: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  thumbEmpty: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  angleLabel: { color: colors.ink, fontWeight: '600' },
  link: { color: colors.brand, fontWeight: '600', marginTop: 2 },
  scanSummary: { color: colors.ink, fontVariant: ['tabular-nums'], marginTop: space.sm, backgroundColor: colors.butter, padding: space.sm, borderRadius: radius.md },
})
