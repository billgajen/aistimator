import {
  OPENING_WORDS,
  formatScanArea,
  formatScanLength,
  formatScanSize,
  roomsCoveredWords,
  type CustomerRoomScanView,
  type RoomScanView,
  type ScanRoomView,
} from '@qolumns/shared'
import { PlanView } from './PlanView'
import { RoomModelViewer } from './RoomModelViewer'

/**
 * T-193: what a room scan measured, for the business (the dashboard's quote
 * page and the approval page draw this same card; the app draws the same
 * figures from the same shared summary). Every figure comes from
 * `roomScanView` (packages/shared/src/room-scan-report.ts) in the business's
 * own units. A scan made before T-193 has no positions and no model: its
 * sizes are shown, without a plan or a viewer.
 *
 * T-194: each scan is an area with its name and the rooms it covers; the
 * walls are lettered as on the plan; the card's sentence says which sizes
 * priced the quote, or that the price does not depend on them
 * (`scanPricedLines`). Never "these sizes priced the quote" when they did not.
 *
 * A room scan is a measurement, so the card is the takeoff's butter and tape
 * (system.md, Colour).
 */

/** `{modelId}` in a path is replaced by the area's model id */
export const modelAddress = (path: string, modelId: string) => path.replace('{modelId}', encodeURIComponent(modelId))

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="figure text-sm text-text-primary">{value}</dd>
    </div>
  )
}

function AreaHeading({ name, roomsCovered }: { name: string; roomsCovered: number }) {
  const covers = roomsCoveredWords(roomsCovered)
  return (
    <h3 className="text-sm font-bold text-text-primary">
      {name}
      {covers && <span className="font-normal text-text-secondary"> · {covers}</span>}
    </h3>
  )
}

function Area({ room, view, modelPath }: { room: ScanRoomView; view: RoomScanView; modelPath: string | null }) {
  const u = view.units
  return (
    <section className="border-t border-tape/30 pt-4 first:border-t-0 first:pt-0" data-testid="scan-room">
      <AreaHeading name={room.name} roomsCovered={room.roomsCovered} />
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Figure label="Floor" value={room.floorArea === null ? 'Not found' : formatScanArea(room.floorArea, u)} />
        <Figure label="Walls" value={formatScanArea(room.wallAreaGross, u)} />
        <Figure label="Walls less doors and windows" value={formatScanArea(room.wallAreaNet, u)} />
        <Figure label="Ceiling height" value={room.ceilingHeight === null ? 'Not found' : formatScanLength(room.ceilingHeight, u)} />
        {room.tallestWall !== null && <Figure label="Tallest wall" value={formatScanLength(room.tallestWall, u)} />}
        <Figure label="Wall length" value={formatScanLength(room.wallLength, u)} />
        <Figure label="Wall length less doors" value={formatScanLength(room.wallLengthLessDoors, u)} />
      </dl>
      {room.planSvg && <PlanView svg={room.planSvg} name={room.name} />}
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-text-secondary">Walls</p>
          <ol className="mt-1 space-y-0.5" data-testid="scan-walls">
            {room.walls.map((wall) => (
              <li key={wall.letter} className="flex justify-between gap-3">
                <span className="text-text-secondary">Wall {wall.letter}</span>
                <span className="figure text-text-primary">{formatScanSize(wall.width, wall.height, u)}</span>
              </li>
            ))}
            {room.smallReturns && (
              <li className="flex justify-between gap-3" data-testid="scan-returns">
                <span className="text-text-secondary">Small returns: {room.smallReturns.count}</span>
                <span className="figure text-text-primary">{formatScanLength(room.smallReturns.length, u)} in all</span>
              </li>
            )}
          </ol>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-text-secondary">Doors and windows</p>
          {room.openings.length === 0 ? (
            <p className="mt-1 text-text-secondary">None found</p>
          ) : (
            <ol className="mt-1 space-y-0.5" data-testid="scan-openings">
              {room.openings.map((opening, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-text-secondary">{OPENING_WORDS[opening.type]}</span>
                  <span className="figure text-text-primary">{formatScanSize(opening.width, opening.height, u)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {room.modelId && modelPath && (
        <div className="mt-3">
          <RoomModelViewer addressPath={modelAddress(modelPath, room.modelId)} roomName={room.name} />
        </div>
      )}
    </section>
  )
}

export function RoomScanCard({ view, modelPath, className = '' }: { view: RoomScanView; modelPath: string | null; className?: string }) {
  const u = view.units
  const t = view.total
  const several = view.rooms.length > 1
  return (
    <div className={`overflow-hidden rounded-2xl border border-tape/40 bg-butter/40 ${className}`} data-testid="room-scan-card">
      <div className="px-5 pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Room scan</p>
        <p className="mt-0.5 text-sm text-text-primary" data-testid="room-scan-priced">
          {view.pricing?.sentence ?? 'Measured on site with the room scan.'}
        </p>
        {several && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" data-testid="scan-totals">
            <Figure label="Areas scanned" value={`${t.areas}, covering ${t.rooms} room${t.rooms === 1 ? '' : 's'}`} />
            {t.floorArea !== null && <Figure label="Floor in all" value={formatScanArea(t.floorArea, u)} />}
            <Figure label="Walls less doors and windows" value={formatScanArea(t.wallAreaNet, u)} />
            <Figure label="Wall length in all" value={formatScanLength(t.wallLength, u)} />
          </dl>
        )}
      </div>
      <div className="tape-rule mx-5" />
      <div className="space-y-4 px-5 py-4">
        {view.rooms.map((room, i) => (
          <Area key={i} room={room} view={view} modelPath={modelPath} />
        ))}
      </div>
    </div>
  )
}

/**
 * T-193/T-194: the customer's "Measured on site" block: each area's name, its plan and its 3D model, and
 * only the sizes that priced the quote (where none did, its wall area and ceiling height). No wall list.
 */
export function MeasuredOnSite({ view, modelPath }: { view: CustomerRoomScanView; modelPath: string | null }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-tape/40 bg-butter/40" data-testid="measured-on-site">
      <div className="px-5 pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Measured on site</p>
        <p className="text-xs text-text-muted">
          {view.priced.length > 0 ? `Priced from these sizes: ${view.priced.join('; ')}.` : 'Measured with a room scan when the job was looked at.'}
        </p>
      </div>
      <div className="tape-rule mx-5" />
      <div className="space-y-5 px-5 py-4">
        {view.rooms.map((room, i) => (
          <section key={i} className="border-t border-tape/30 pt-4 first:border-t-0 first:pt-0" data-testid="measured-room">
            <AreaHeading name={room.name} roomsCovered={room.roomsCovered} />
            <dl className="mt-2 grid grid-cols-2 gap-4">
              {room.figures.map((f) => (
                <Figure key={f.label} label={f.label} value={f.value} />
              ))}
            </dl>
            {room.planSvg && <PlanView svg={room.planSvg} name={room.name} />}
            {room.modelId && modelPath && (
              <div className="mt-3">
                <RoomModelViewer addressPath={modelAddress(modelPath, room.modelId)} roomName={room.name} />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
