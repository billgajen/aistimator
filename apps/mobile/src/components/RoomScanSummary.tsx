/**
 * T-193: what a room scan measured, in the app. The same figures, in the
 * same units and words, as the dashboard's card: they come from the shared
 * summary (packages/shared/src/room-scan-report.ts), and the floor plan is
 * the same drawing (floorPlanSvg).
 *
 * Shown straight after a scan, so the sizes can be checked before the job is
 * priced (with "Scan again" for an area that came out wrong), and on the
 * quote screen above the price.
 *
 * T-194: each scan is an area: its name (typed, with the business's own
 * earlier names to pick from) and how many rooms it covers are asked
 * straight after the scan. The walls are lettered as on the plan; the plan is
 * the width of the screen and opens larger with a tap; "View in 3D" opens the
 * web's viewer (no Quick Look, no AR). On the quote screen the card says
 * which sizes priced the quote, or that the price does not depend on them.
 *
 * A scan is a measurement, so its figures sit on butter (system.md).
 */
import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'
import { OPENING_WORDS, formatScanArea, formatScanLength, formatScanSize, roomsCoveredWords, type RoomScanView, type ScanRoomView } from '@qolumns/shared'
import { colors, fonts, radius, scale, space, tabular, touch, type } from '../theme'
import { Button, Icon, Label, Muted } from './ui'

/** One plain tip for the scan card (T-194): no limits beyond the scan's own sanity bounds */
export const SCAN_TIP = 'Scanning one room at a time is the most accurate. A whole floor works too, but is less precise.'

/** The most areas a scan covers, as the server allows (room-scan.ts LIMITS) */
const MOST_ROOMS = 40

export interface RoomActions {
  /** Open this area's model (absent when it has none, or it cannot be shown yet) */
  onModel?: (index: number) => void
  onScanAgain?: (index: number) => void
  onRemove?: (index: number) => void
}

/** T-194: naming an area and saying how many rooms it covers, straight after the scan */
export interface AreaEditing {
  onName: (index: number, name: string) => void
  onRoomsCovered: (index: number, rooms: number) => void
  /** The business's own earlier names, to pick from (most recent first) */
  names: readonly string[]
  /** The draft's own names, so the name field shows what was typed (the view shows a fallback) */
  typedNames: ReadonlyArray<string | undefined>
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.figureLabel} maxFontSizeMultiplier={scale.large}>
        {label}
      </Text>
      <Text style={styles.figureValue} maxFontSizeMultiplier={scale.large}>
        {value}
      </Text>
    </View>
  )
}

const ratioOf = (svg: string) => {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  return box ? Number(box[2]) / Number(box[1]) : 1
}

/** The plan at the width it is given, keeping its shape; a tap opens it larger, to pinch and turn about */
function Plan({ svg, width }: { svg: string; width: number }) {
  const [large, setLarge] = useState(false)
  const screen = useWindowDimensions()
  const ratio = ratioOf(svg)
  const label = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? 'Floor plan'
  const bigWidth = screen.width - space.lg * 2
  // T-200: on Android the larger plan is drawn behind the navigation bar too, so "Close" is kept clear of it
  const insets = useSafeAreaInsets()
  const clear = Platform.OS === 'android' ? { paddingBottom: space.xl + insets.bottom } : null
  return (
    <>
      <Pressable style={styles.plan} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Open it larger`} onPress={() => setLarge(true)}>
        <SvgXml xml={svg} width={width} height={Math.round(width * ratio)} />
        <Text style={styles.planHint} maxFontSizeMultiplier={scale.text}>
          Tap to enlarge
        </Text>
      </Pressable>
      <Modal visible={large} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setLarge(false)}>
        <View style={[styles.planScreen, clear]}>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={styles.planZoom} centerContent>
            <View accessible accessibilityRole="image" accessibilityLabel={label}>
              <SvgXml xml={svg} width={bigWidth} height={Math.round(bigWidth * ratio)} />
            </View>
          </ScrollView>
          <View style={styles.planClose}>
            <Button title="Close" variant="secondary" onPress={() => setLarge(false)} />
          </View>
        </View>
      </Modal>
    </>
  )
}

/** "How many rooms does this cover?" with − and + (default 1) */
function RoomsStepper({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  const step = (by: number) => onChange(Math.min(MOST_ROOMS, Math.max(1, value + by)))
  return (
    <View style={{ marginTop: space.sm }}>
      <Text style={styles.ask} maxFontSizeMultiplier={scale.large}>
        How many rooms does this cover?
      </Text>
      <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={`Rooms ${name} covers`} accessibilityValue={{ now: value, min: 1, max: MOST_ROOMS }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
        <Pressable style={[styles.stepButton, value <= 1 && { opacity: 0.45 }]} onPress={() => step(-1)} disabled={value <= 1} accessibilityLabel="One room fewer">
          <Icon name="remove" color={colors.brand} />
        </Pressable>
        <Text style={styles.stepValue} maxFontSizeMultiplier={scale.large}>
          {value}
        </Text>
        <Pressable style={[styles.stepButton, value >= MOST_ROOMS && { opacity: 0.45 }]} onPress={() => step(1)} disabled={value >= MOST_ROOMS} accessibilityLabel="One room more">
          <Icon name="add" color={colors.brand} />
        </Pressable>
      </View>
    </View>
  )
}

/** The area's name: typed, or one of the business's own earlier names with a tap */
function AreaName({ value, onChange, names }: { value: string; onChange: (name: string) => void; names: readonly string[] }) {
  const picks = names.filter((n) => n.toLowerCase() !== value.trim().toLowerCase()).slice(0, 6)
  return (
    <View>
      <Text style={styles.ask} maxFontSizeMultiplier={scale.large}>
        What is this area called?
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, 60))}
        placeholder="For example, what you call it on site"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Area name"
        maxFontSizeMultiplier={scale.large}
        style={styles.input}
        autoCapitalize="sentences"
        returnKeyType="done"
      />
      {picks.length > 0 ? (
        <View style={styles.picks}>
          {picks.map((name) => (
            <Pressable key={name} style={styles.pick} onPress={() => onChange(name)} accessibilityRole="button" accessibilityLabel={`Name it ${name}`}>
              <Text style={styles.pickText} maxFontSizeMultiplier={scale.large}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Area({
  room,
  index,
  view,
  planWidth,
  detail,
  hasModel,
  actions,
  editing,
}: {
  room: ScanRoomView
  index: number
  view: RoomScanView
  planWidth: number
  detail: boolean
  hasModel?: (index: number) => boolean
  actions: RoomActions
  editing?: AreaEditing
}) {
  const u = view.units
  const covers = roomsCoveredWords(room.roomsCovered)
  return (
    <View style={[styles.room, index > 0 && styles.roomRule]}>
      {editing ? (
        <View style={{ gap: space.sm }}>
          <AreaName value={editing.typedNames[index] ?? ''} onChange={(name) => editing.onName(index, name)} names={editing.names} />
          <RoomsStepper value={room.roomsCovered} onChange={(n) => editing.onRoomsCovered(index, n)} name={room.name} />
        </View>
      ) : (
        <Label>{covers ? `${room.name} · ${covers}` : room.name}</Label>
      )}
      <View style={styles.figures}>
        <Figure label="Floor" value={room.floorArea === null ? 'Not found' : formatScanArea(room.floorArea, u)} />
        <Figure label="Walls" value={formatScanArea(room.wallAreaGross, u)} />
        <Figure label="Walls less doors and windows" value={formatScanArea(room.wallAreaNet, u)} />
        <Figure label="Ceiling height" value={room.ceilingHeight === null ? 'Not found' : formatScanLength(room.ceilingHeight, u)} />
        {room.tallestWall !== null ? <Figure label="Tallest wall" value={formatScanLength(room.tallestWall, u)} /> : null}
        <Figure label="Wall length" value={formatScanLength(room.wallLength, u)} />
        <Figure label="Wall length less doors" value={formatScanLength(room.wallLengthLessDoors, u)} />
      </View>
      {room.planSvg ? <Plan svg={room.planSvg} width={planWidth} /> : null}
      {detail ? (
        <View style={{ gap: 2, marginTop: space.sm }}>
          {room.walls.map((wall) => (
            <View key={wall.letter} style={styles.line}>
              <Muted>{`Wall ${wall.letter}`}</Muted>
              <Text style={styles.lineValue}>{formatScanSize(wall.width, wall.height, u)}</Text>
            </View>
          ))}
          {room.smallReturns ? (
            <View style={styles.line}>
              <Muted>{`Small returns: ${room.smallReturns.count}`}</Muted>
              <Text style={styles.lineValue}>{`${formatScanLength(room.smallReturns.length, u)} in all`}</Text>
            </View>
          ) : null}
          {room.openings.map((opening, o) => (
            <View key={`o${o}`} style={styles.line}>
              <Muted>{OPENING_WORDS[opening.type]}</Muted>
              <Text style={styles.lineValue}>{formatScanSize(opening.width, opening.height, u)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {(actions.onModel && hasModel?.(index)) || actions.onScanAgain || actions.onRemove ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {actions.onModel && hasModel?.(index) ? <Button title="View in 3D" icon="cube-outline" variant="secondary" onPress={() => actions.onModel!(index)} label={`View ${room.name} in 3D`} /> : null}
          {actions.onScanAgain ? <Button title="Scan again" icon="scan-outline" variant="quiet" onPress={() => actions.onScanAgain!(index)} label={`Scan ${room.name} again`} /> : null}
          {actions.onRemove ? <Button title="Remove this area" variant="quiet" onPress={() => actions.onRemove!(index)} label={`Remove ${room.name}`} /> : null}
        </View>
      ) : null}
    </View>
  )
}

export function RoomScanSummary({
  view,
  hasModel,
  actions = {},
  detail = true,
  editing,
  inset = space.lg * 4,
}: {
  view: RoomScanView
  /** Can this area's model be opened here? */
  hasModel?: (index: number) => boolean
  actions?: RoomActions
  /** The wall-by-wall list and the openings (the quote screen and the scan result both show them) */
  detail?: boolean
  editing?: AreaEditing
  /** How much narrower than the screen the plan is (the screen's and the card's padding) */
  inset?: number
}) {
  const screen = useWindowDimensions()
  const planWidth = Math.max(200, screen.width - inset - space.xs * 2)
  const u = view.units
  const t = view.total
  return (
    <View style={{ gap: space.lg }}>
      {view.rooms.length > 1 ? (
        <View style={styles.totals} accessible>
          <Text style={styles.total} maxFontSizeMultiplier={scale.text}>
            {`${t.areas} areas, covering ${t.rooms} room${t.rooms === 1 ? '' : 's'}`}
          </Text>
          <Text style={styles.totalLine} maxFontSizeMultiplier={scale.text}>
            {[t.floorArea === null ? null : `${formatScanArea(t.floorArea, u)} floor`, `${formatScanArea(t.wallAreaNet, u)} walls less doors and windows`, `${formatScanLength(t.wallLength, u)} of wall`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ) : null}
      {view.rooms.map((room, i) => (
        <Area key={i} room={room} index={i} view={view} planWidth={planWidth} detail={detail} hasModel={hasModel} actions={actions} editing={editing} />
      ))}
    </View>
  )
}

/**
 * The quote screen's card: the heading, which sizes priced the quote (never "these sizes priced the
 * quote" when they did not), then the summary; "Scan again" and "Add an area" until it is approved.
 */
export function RoomScanCard({
  view,
  onModel,
  hasModel,
  onScanAgain,
  onAddArea,
  busy,
}: {
  view: RoomScanView
  onModel?: (index: number) => void
  hasModel?: (index: number) => boolean
  onScanAgain?: (index: number) => void
  onAddArea?: () => void
  busy?: boolean
}) {
  return (
    <View style={styles.card} accessibilityLabel="Room scan">
      <View style={styles.head}>
        <Icon name="scan-outline" color={colors.brand} />
        <Label>Room scan</Label>
      </View>
      <Muted style={{ marginBottom: space.md }}>{view.pricing?.sentence ?? 'Measured on site.'}</Muted>
      <RoomScanSummary view={view} hasModel={hasModel} actions={{ ...(onModel && { onModel }), ...(onScanAgain && { onScanAgain }) }} />
      {onAddArea ? (
        <View style={{ marginTop: space.md }}>
          <Button title="Add an area" icon="add-circle-outline" variant="secondary" onPress={onAddArea} busy={busy} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  totals: { backgroundColor: colors.butter, borderRadius: radius.md, padding: space.md, gap: 2 },
  total: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body },
  totalLine: { color: colors.ink, fontFamily: fonts.body, fontSize: type.small, fontVariant: tabular },
  room: { gap: space.xs },
  roomRule: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.lg },
  ask: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, marginBottom: space.xs },
  input: { minHeight: touch.min, borderWidth: 1, borderColor: colors.field, borderRadius: radius.md, paddingHorizontal: space.md, color: colors.ink, fontFamily: fonts.body, fontSize: type.body, backgroundColor: colors.white },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  pick: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.field, backgroundColor: colors.white },
  pickText: { color: colors.ink, fontFamily: fonts.body, fontSize: type.small },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepButton: { width: touch.min, height: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.field, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  stepValue: { minWidth: 32, textAlign: 'center', color: colors.ink, fontFamily: fonts.semi, fontSize: type.large, fontVariant: tabular },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  // butter is for measurement, and these are
  figure: { backgroundColor: colors.butter, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: '46%', flexGrow: 1 },
  figureLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.small },
  figureValue: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, fontVariant: tabular },
  plan: { marginTop: space.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.xs, alignItems: 'center', overflow: 'hidden' },
  planHint: { color: colors.muted, fontFamily: fonts.body, fontSize: type.note, marginTop: 2 },
  planScreen: { flex: 1, backgroundColor: colors.white, paddingTop: space.xl * 2, paddingBottom: space.xl },
  planZoom: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  planClose: { paddingHorizontal: space.lg },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  lineValue: { color: colors.ink, fontFamily: fonts.body, fontSize: type.body, fontVariant: tabular },
})
