/**
 * T-193: what a room scan measured, in the app. The same figures, in the
 * same units and words, as the dashboard's card: they come from the shared
 * summary (packages/shared/src/room-scan-report.ts), and the floor plan is
 * the same drawing (floorPlanSvg).
 *
 * Shown straight after a scan, so the sizes can be checked before the job is
 * priced (with "Scan again" for a room that came out wrong), and on the quote
 * screen above the price. A room's 3D model opens in iOS Quick Look.
 *
 * A scan is a measurement, so its figures sit on butter (system.md).
 */
import { StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { OPENING_WORDS, formatScanArea, formatScanLength, formatScanSize, type RoomScanView } from '@qolumns/shared'
import { colors, fonts, radius, scale, space, tabular, type } from '../theme'
import { Button, Icon, Label, Muted } from './ui'

export interface RoomActions {
  /** Open this room's model (absent when the room has none, or this build cannot show one) */
  onModel?: (index: number) => void
  onScanAgain?: (index: number) => void
  onRemove?: (index: number) => void
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

/** The plan drawn at the width it is given, keeping its shape */
function Plan({ svg, width }: { svg: string; width: number }) {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  const ratio = box ? Number(box[2]) / Number(box[1]) : 1
  const label = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? 'Floor plan'
  return (
    <View style={styles.plan} accessible accessibilityRole="image" accessibilityLabel={label}>
      <SvgXml xml={svg} width={width} height={Math.round(width * ratio)} />
    </View>
  )
}

export function RoomScanSummary({
  view,
  hasModel,
  actions = {},
  detail = true,
  planWidth = 300,
}: {
  view: RoomScanView
  /** Can this room's model be opened here? */
  hasModel?: (index: number) => boolean
  actions?: RoomActions
  /** The wall-by-wall list and the openings (the quote screen and the scan result both show them) */
  detail?: boolean
  planWidth?: number
}) {
  const u = view.units
  const several = view.rooms.length > 1
  return (
    <View style={{ gap: space.lg }}>
      {several ? (
        <Text style={styles.total} maxFontSizeMultiplier={scale.text}>
          {`${view.total.rooms} rooms: ${view.total.floorArea === null ? '' : `${formatScanArea(view.total.floorArea, u)} floor, `}${formatScanArea(view.total.wallAreaNet, u)} walls less doors and windows`}
        </Text>
      ) : null}
      {view.rooms.map((room, i) => (
        <View key={i} style={[styles.room, i > 0 && styles.roomRule]}>
          <Label>{room.name}</Label>
          <View style={styles.figures}>
            <Figure label="Floor" value={room.floorArea === null ? 'Not found' : formatScanArea(room.floorArea, u)} />
            <Figure label="Walls" value={formatScanArea(room.wallAreaGross, u)} />
            <Figure label="Walls less doors and windows" value={formatScanArea(room.wallAreaNet, u)} />
            <Figure label="Ceiling height" value={room.ceilingHeight === null ? 'Not found' : formatScanLength(room.ceilingHeight, u)} />
            <Figure label="Perimeter" value={formatScanLength(room.perimeter, u)} />
          </View>
          {room.planSvg ? <Plan svg={room.planSvg} width={planWidth} /> : null}
          {detail ? (
            <View style={{ gap: 2, marginTop: space.sm }}>
              {room.walls.map((wall, w) => (
                <View key={`w${w}`} style={styles.line}>
                  <Muted>{`Wall ${w + 1}`}</Muted>
                  <Text style={styles.lineValue}>{formatScanSize(wall.width, wall.height, u)}</Text>
                </View>
              ))}
              {room.openings.map((opening, o) => (
                <View key={`o${o}`} style={styles.line}>
                  <Muted>{OPENING_WORDS[opening.type]}</Muted>
                  <Text style={styles.lineValue}>{formatScanSize(opening.width, opening.height, u)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {actions.onModel || actions.onScanAgain || actions.onRemove ? (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              {actions.onModel && hasModel?.(i) ? <Button title="View in 3D" icon="cube-outline" variant="secondary" onPress={() => actions.onModel!(i)} label={`View ${room.name} in 3D`} /> : null}
              {actions.onScanAgain ? <Button title="Scan again" icon="scan-outline" variant="quiet" onPress={() => actions.onScanAgain!(i)} label={`Scan ${room.name} again`} /> : null}
              {actions.onRemove ? <Button title="Remove this room" variant="quiet" onPress={() => actions.onRemove!(i)} label={`Remove ${room.name}`} /> : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/** The quote screen's card: the heading, then the summary */
export function RoomScanCard({ view, onModel, hasModel }: { view: RoomScanView; onModel?: (index: number) => void; hasModel?: (index: number) => boolean }) {
  return (
    <View style={styles.card} accessibilityLabel="Room scan">
      <View style={styles.head}>
        <Icon name="scan-outline" color={colors.brand} />
        <Label>Room scan</Label>
      </View>
      <Muted style={{ marginBottom: space.md }}>Measured on site. These sizes priced the quote.</Muted>
      <RoomScanSummary view={view} hasModel={hasModel} actions={onModel ? { onModel } : {}} planWidth={280} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  total: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body },
  room: { gap: space.xs },
  roomRule: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.lg },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  // butter is for measurement, and these are
  figure: { backgroundColor: colors.butter, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: '46%', flexGrow: 1 },
  figureLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.small },
  figureValue: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, fontVariant: tabular },
  plan: { marginTop: space.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.xs, alignItems: 'center', overflow: 'hidden' },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  lineValue: { color: colors.ink, fontFamily: fonts.body, fontSize: type.body, fontVariant: tabular },
})
