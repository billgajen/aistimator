'use client'

import { useEffect, useRef, useState } from 'react'
import { MODEL_COLOR } from '@qolumns/shared'

/**
 * T-193/T-194: a scanned area's 3D model, turned with a finger or the mouse.
 * One viewer for the dashboard, the approval page, the customer's quote page
 * and the business app (which opens the /room-model page in its own browser).
 *
 * Nothing is fetched until it is opened: then the page asks its own route for
 * the model's address (signed for a few minutes, and only for a model of this
 * quote: lib/room-models.ts), or is handed one (`src`, the app's page), and
 * loads the 3D library (three.js, with its USD loader) as a separate piece of
 * the page. A model that is missing or will not load says so in one line; the
 * sizes and the floor plan around it are unaffected.
 *
 * T-194, what it looks like: the model fills about 80% of the view, centred,
 * seen from a three-quarter angle above; a taller view on a phone; a full
 * screen button and "Reset view". The stage is ink, the walls light with
 * their edges drawn, the floor tinted, doors and windows in the brand colour
 * (the business's own on its customer's page), so nothing is pale on pale.
 * No AR.
 */
type State = 'idle' | 'loading' | 'shown' | 'failed'

/** RoomPlan names each part of its model by what it is (Apple's own names): a wall, a door, a window… */
function partOf(object: { name: string; parent: unknown }): keyof typeof MODEL_COLOR | 'object' {
  for (let o: { name: string; parent: unknown } | null = object; o; o = (o.parent as typeof o) ?? null) {
    const name = o.name.toLowerCase()
    if (name.includes('door')) return 'door'
    if (name.includes('window')) return 'window'
    if (name.includes('opening')) return 'opening'
    if (name.includes('floor')) return 'floor'
    if (name.includes('wall')) return 'wall'
  }
  return 'object'
}

/** The brand colour of the page (a business's own on its customer's quote page), as a number for three.js */
function brandColour(): number {
  try {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--color-primary-rgb').trim().split(/\s+/).map(Number)
    if (rgb.length === 3 && rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 255)) return (rgb[0]! << 16) | (rgb[1]! << 8) | rgb[2]!
  } catch {
    // the token is read where there is a document; without one, juniper
  }
  return MODEL_COLOR.door
}

/** The view's height for its width: taller on a phone */
export function viewerHeight(width: number, viewportHeight: number): number {
  if (width < 640) return Math.round(Math.min(width * 1.15, viewportHeight * 0.7))
  return Math.round(Math.min(560, Math.max(320, width * 0.6)))
}

/**
 * How far the camera stands so the model's bounding sphere fills `fill` of the narrower side of the view.
 * `fovDeg` is the vertical field of view.
 */
export function framingDistance(radius: number, fovDeg: number, aspect: number, fill = 0.8): number {
  const vertical = (fovDeg * Math.PI) / 180
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect)
  const half = Math.min(vertical, horizontal) / 2
  return radius / (Math.sin(half) * fill)
}

type V3 = [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/**
 * How far from the model's middle the camera stands, looking back along `direction`, so the model's box
 * (its corners, relative to its middle) fills `fill` of the view across and up. Fitting the box as the
 * camera sees it, not its bounding sphere: a room is wide and low, and a sphere left it small.
 */
export function fitDistance(corners: readonly V3[], direction: V3, fovDeg: number, aspect: number, fill = 0.8): number {
  const back = unit(direction)
  const forward: V3 = [-back[0], -back[1], -back[2]]
  const right = unit(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const ty = Math.tan((fovDeg * Math.PI) / 360) * fill
  const tx = ty * aspect
  let d = 0
  for (const p of corners) d = Math.max(d, dot(p, back) + Math.max(Math.abs(dot(p, right)) / tx, Math.abs(dot(p, up)) / ty))
  return d
}

export function RoomModelViewer({
  addressPath,
  src,
  roomName,
  fullPage = false,
}: {
  /** The page's own route that answers { url } for this model */
  addressPath?: string
  /** Or the model's signed address itself (the app's viewer page) */
  src?: string
  roomName: string
  /** The app's page: opens straight away and fills the screen */
  fullPage?: boolean
}) {
  const [state, setState] = useState<State>('idle')
  const [expanded, setExpanded] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const mount = useRef<HTMLDivElement>(null)
  const api = useRef<{ reset: () => void; resize: () => void; dispose: () => void } | null>(null)

  useEffect(() => () => api.current?.dispose(), [])
  useEffect(() => {
    if (fullPage) void open()
    // open once, when the app's page is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullPage])
  // the view is drawn again at its new size when it goes full screen or the window turns
  useEffect(() => {
    api.current?.resize()
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  async function open() {
    setState('loading')
    try {
      let url = src
      if (!url && addressPath) {
        const response = await fetch(addressPath, { cache: 'no-store' })
        if (!response.ok) throw new Error('address')
        url = ((await response.json()) as { url?: string }).url
      }
      if (!url) throw new Error('address')
      const [THREE, { USDLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/USDLoader.js'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ])
      const host = mount.current
      if (!host) return
      const model = await new USDLoader().loadAsync(url)

      // the parts, coloured by what they are, each with its edges drawn
      const brand = brandColour()
      const colourOf = { ...MODEL_COLOR, door: brand, window: brand }
      const edges = new THREE.LineBasicMaterial({ color: MODEL_COLOR.edge })
      const meshes: InstanceType<typeof THREE.Mesh>[] = []
      model.traverse((o) => {
        if ((o as InstanceType<typeof THREE.Mesh>).isMesh) meshes.push(o as InstanceType<typeof THREE.Mesh>)
      })
      for (const mesh of meshes) {
        const part = partOf(mesh)
        // a model without normals would be drawn black: give each face its own
        if (!mesh.geometry.getAttribute('normal')) {
          mesh.geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
          mesh.geometry.computeVertexNormals()
        }
        mesh.material = new THREE.MeshStandardMaterial({
          color: colourOf[part],
          roughness: 0.85,
          metalness: 0,
          side: THREE.DoubleSide,
          ...(part === 'window' && { transparent: true, opacity: 0.75 }),
          ...(part === 'opening' && { transparent: true, opacity: 0.25 }),
        })
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), edges))
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(MODEL_COLOR.stage, 1)
      host.replaceChildren(renderer.domElement)
      renderer.domElement.setAttribute('role', 'img')
      renderer.domElement.setAttribute('aria-label', `3D model of ${roomName}. Drag to turn it, pinch or scroll to zoom.`)
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.touchAction = 'none'

      const scene = new THREE.Scene()
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 1.6))
      scene.add(new THREE.AmbientLight(0xffffff, 0.5))
      const sun = new THREE.DirectionalLight(0xffffff, 1.6)
      sun.position.set(4, 10, 6)
      scene.add(sun)
      scene.add(model)

      // frame it: its middle, from a three-quarter angle above, filling about 80% of the view
      const box = new THREE.Box3().setFromObject(model)
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      const radius = sphere.radius || 3
      const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 40)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      const direction = new THREE.Vector3(1, 0.9, 1.15).normalize()
      const corners: V3[] = []
      for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) corners.push([cx - sphere.center.x, cy - sphere.center.y, cz - sphere.center.z])
      const reset = () => {
        const d = corners.length ? fitDistance(corners, [direction.x, direction.y, direction.z], camera.fov, camera.aspect) : framingDistance(radius, camera.fov, camera.aspect)
        camera.position.copy(sphere.center).addScaledVector(direction, d)
        controls.target.copy(sphere.center)
        controls.update()
      }
      const resize = () => {
        const filling = fullPage || frame.current?.dataset.expanded === 'true'
        if (filling) host.style.height = ''
        const width = host.clientWidth || 320
        const height = filling ? host.clientHeight || window.innerHeight : viewerHeight(width, window.innerHeight)
        if (!filling) host.style.height = `${height}px`
        renderer.setSize(width, height, false)
        renderer.domElement.style.width = '100%'
        renderer.domElement.style.height = `${height}px`
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      resize()
      reset()
      const watcher = new ResizeObserver(() => resize())
      watcher.observe(host)

      let raf = 0
      const draw = () => {
        raf = requestAnimationFrame(draw)
        controls.update()
        renderer.render(scene, camera)
      }
      draw()
      api.current = {
        reset,
        resize,
        dispose: () => {
          cancelAnimationFrame(raf)
          watcher.disconnect()
          controls.dispose()
          renderer.dispose()
        },
      }
      setState('shown')
    } catch {
      setState('failed')
    }
  }

  const button =
    'inline-flex min-h-[44px] items-center rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2'
  const stageButton = `${button} border-white bg-ink text-white hover:bg-white/10 focus-visible:ring-white`
  return (
    <div data-testid="room-model" className={fullPage ? 'flex h-full flex-col' : undefined}>
      <div
        ref={frame}
        data-expanded={expanded ? 'true' : 'false'}
        className={
          state === 'shown' || (fullPage && state === 'loading')
            ? expanded
              ? 'fixed inset-0 z-50 flex flex-col bg-ink'
              : fullPage
                ? 'flex min-h-0 flex-1 flex-col bg-ink'
                : 'overflow-hidden rounded-xl bg-ink'
            : 'hidden'
        }
      >
        <div ref={mount} className={expanded || fullPage ? 'min-h-0 flex-1 overflow-hidden' : 'w-full overflow-hidden'} data-testid="room-model-stage" />
        {state === 'shown' && (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
            <button type="button" className={stageButton} onClick={() => api.current?.reset()} data-testid="room-model-reset">
              Reset view
            </button>
            {!fullPage && (
              <button type="button" className={stageButton} onClick={() => setExpanded((e) => !e)} aria-pressed={expanded} data-testid="room-model-full">
                {expanded ? 'Close full screen' : 'Full screen'}
              </button>
            )}
            <p className="text-xs text-white">Drag to turn it; pinch or scroll to zoom.</p>
          </div>
        )}
      </div>
      {state === 'idle' && !fullPage && (
        <button
          type="button"
          onClick={open}
          className={`${button} border-border-strong bg-white text-text-primary hover:bg-surface focus-visible:ring-primary`}
          data-testid="room-model-open"
        >
          View in 3D
        </button>
      )}
      {state === 'loading' && (
        <p className={fullPage ? 'p-4 text-sm text-white' : 'text-sm text-text-secondary'} role="status">
          Loading the 3D model…
        </p>
      )}
      {state === 'failed' && (
        <p className={fullPage ? 'p-4 text-sm text-white' : 'text-sm text-text-secondary'} role="status" data-testid="room-model-failed">
          The 3D model could not be shown here. The sizes and the floor plan are unaffected.
        </p>
      )}
    </div>
  )
}
