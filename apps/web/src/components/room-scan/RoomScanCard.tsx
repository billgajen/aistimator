import {
  OPENING_WORDS,
  formatScanArea,
  formatScanLength,
  formatScanSize,
  type CustomerRoomScanView,
  type RoomScanView,
  type ScanRoomView,
} from '@qolumns/shared'
import { RoomModelViewer } from './RoomModelViewer'

/**
 * T-193: what a room scan measured, for the business (the dashboard's quote
 * page and the approval page draw this same card; the app draws the same
 * figures from the same shared summary). Every figure comes from
 * `roomScanView` (packages/shared/src/room-scan-report.ts) in the business's
 * own units. A scan made before T-193 has no positions and no model: its
 * sizes are shown, without a plan or a viewer.
 *
 * A room scan is a measurement, so the card is the takeoff's butter and tape
 * (system.md, Colour).
 */

/** `{modelId}` in a path is replaced by the room's model id */
export const modelAddress = (path: string, modelId: string) => path.replace('{modelId}', encodeURIComponent(modelId))

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="figure text-sm text-text-primary">{value}</dd>
    </div>
  )
}

/** The plan is our own SVG: only numbers and the escaped room name go into it (floorPlanSvg) */
function Plan({ svg }: { svg: string }) {
  return (
    <div
      className="mt-3 overflow-hidden rounded-xl border border-tape/40 bg-white p-2 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
      data-testid="room-plan"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function Room({ room, view, modelPath, showName }: { room: ScanRoomView; view: RoomScanView; modelPath: string | null; showName: boolean }) {
  const u = view.units
  return (
    <section className="border-t border-tape/30 pt-4 first:border-t-0 first:pt-0" data-testid="scan-room">
      {showName && <h3 className="text-sm font-bold text-text-primary">{room.name}</h3>}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Figure label="Floor" value={room.floorArea === null ? 'Not found' : formatScanArea(room.floorArea, u)} />
        <Figure label="Walls" value={formatScanArea(room.wallAreaGross, u)} />
        <Figure label="Walls less doors and windows" value={formatScanArea(room.wallAreaNet, u)} />
        <Figure label="Ceiling height" value={room.ceilingHeight === null ? 'Not found' : formatScanLength(room.ceilingHeight, u)} />
        <Figure label="Perimeter" value={formatScanLength(room.perimeter, u)} />
      </dl>
      {room.planSvg && <Plan svg={room.planSvg} />}
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-text-secondary">Walls</p>
          <ol className="mt-1 space-y-0.5" data-testid="scan-walls">
            {room.walls.map((wall, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-text-secondary">Wall {i + 1}</span>
                <span className="figure text-text-primary">{formatScanSize(wall.width, wall.height, u)}</span>
              </li>
            ))}
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
  const several = view.rooms.length > 1
  return (
    <div className={`overflow-hidden rounded-2xl border border-tape/40 bg-butter/40 ${className}`} data-testid="room-scan-card">
      <div className="px-5 pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Room scan</p>
        <p className="mt-0.5 text-sm text-text-primary">
          {several
            ? `${view.total.rooms} rooms measured on site: ${view.total.floorArea === null ? '' : `${formatScanArea(view.total.floorArea, u)} of floor, `}${formatScanArea(view.total.wallAreaNet, u)} of wall less doors and windows.`
            : 'Measured on site with the room scan.'}
        </p>
      </div>
      <div className="tape-rule mx-5" />
      <div className="space-y-4 px-5 py-4">
        {view.rooms.map((room, i) => (
          <Room key={i} room={room} view={view} modelPath={modelPath} showName={several || Boolean(room.name)} />
        ))}
      </div>
    </div>
  )
}

/**
 * T-193: the customer's "Measured on site" block: each room's floor and wall area, its plan and its 3D
 * model. No wall-by-wall list (the business's card has it).
 */
export function MeasuredOnSite({ view, modelPath }: { view: CustomerRoomScanView; modelPath: string | null }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-tape/40 bg-butter/40" data-testid="measured-on-site">
      <div className="px-5 pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Measured on site</p>
        <p className="text-xs text-text-muted">Measured with a room scan when the job was looked at.</p>
      </div>
      <div className="tape-rule mx-5" />
      <div className="space-y-5 px-5 py-4">
        {view.rooms.map((room, i) => (
          <section key={i} className="border-t border-tape/30 pt-4 first:border-t-0 first:pt-0" data-testid="measured-room">
            <h3 className="text-sm font-bold text-text-primary">{room.name}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-4">
              {room.floorArea && <Figure label="Floor area" value={room.floorArea} />}
              <Figure label="Wall area" value={room.wallArea} />
            </dl>
            {room.planSvg && <Plan svg={room.planSvg} />}
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
