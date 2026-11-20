'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * T-193: a scanned room's 3D model, turned with a finger or the mouse.
 *
 * Nothing is fetched until the button is pressed: then the page asks its own
 * route for the model's address (signed for a few minutes, and only for a
 * model of this quote: lib/room-models.ts), and loads the 3D library
 * (three.js, with its USD loader) as a separate piece of the page. A model
 * that is missing or will not load says so in one line; the sizes and the
 * floor plan around it are unaffected.
 *
 * On an iPhone or iPad the same file can also be opened in AR Quick Look.
 */
type State = 'idle' | 'loading' | 'shown' | 'failed'

export function RoomModelViewer({ addressPath, roomName }: { addressPath: string; roomName: string }) {
  const [state, setState] = useState<State>('idle')
  const [arUrl, setArUrl] = useState<string | null>(null)
  const mount = useRef<HTMLDivElement>(null)
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  async function open() {
    setState('loading')
    try {
      const response = await fetch(addressPath, { cache: 'no-store' })
      if (!response.ok) throw new Error('address')
      const { url } = (await response.json()) as { url?: string }
      if (!url) throw new Error('address')
      if (supportsAr()) setArUrl(url)
      const [THREE, { USDLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/USDLoader.js'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ])
      const host = mount.current
      if (!host) return
      const model = await new USDLoader().loadAsync(url)

      const width = host.clientWidth || 320
      const height = Math.round(Math.min(420, Math.max(260, width * 0.75)))
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height)
      host.replaceChildren(renderer.domElement)
      renderer.domElement.setAttribute('role', 'img')
      renderer.domElement.setAttribute('aria-label', `3D model of ${roomName}. Drag to turn it, pinch or scroll to zoom.`)

      const scene = new THREE.Scene()
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b3a6, 2.2))
      const sun = new THREE.DirectionalLight(0xffffff, 1.4)
      sun.position.set(4, 8, 6)
      scene.add(sun)
      scene.add(model)

      // frame the room: look at its middle from above and to one side
      const box = new THREE.Box3().setFromObject(model)
      const centre = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3()).length() || 5
      const camera = new THREE.PerspectiveCamera(45, width / height, size / 100, size * 20)
      camera.position.set(centre.x + size * 0.6, centre.y + size * 0.8, centre.z + size * 0.6)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.copy(centre)
      controls.enableDamping = true
      controls.update()

      let frame = 0
      const draw = () => {
        frame = requestAnimationFrame(draw)
        controls.update()
        renderer.render(scene, camera)
      }
      draw()
      cleanup.current = () => {
        cancelAnimationFrame(frame)
        controls.dispose()
        renderer.dispose()
      }
      setState('shown')
    } catch {
      setState('failed')
    }
  }

  return (
    <div data-testid="room-model">
      <div ref={mount} className={state === 'shown' ? 'overflow-hidden rounded-xl border border-border bg-surface' : 'hidden'} />
      {state === 'idle' && (
        <button
          type="button"
          onClick={open}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-border-strong bg-white px-4 py-2 text-sm font-semibold text-text-primary transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="room-model-open"
        >
          View the room in 3D
        </button>
      )}
      {state === 'loading' && (
        <p className="text-sm text-text-secondary" role="status">
          Loading the 3D model…
        </p>
      )}
      {state === 'failed' && (
        <p className="text-sm text-text-secondary" role="status" data-testid="room-model-failed">
          The 3D model could not be shown here. The sizes and the floor plan are unaffected.
        </p>
      )}
      {state === 'shown' && <p className="mt-2 text-xs text-text-muted">Drag to turn it; pinch or scroll to zoom.</p>}
      {arUrl && state !== 'loading' && (
        // AR Quick Look on an iPhone or iPad: Safari opens the file in the room around you. It wants an image as the link's first child.
        <a rel="ar" href={arUrl} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4" data-testid="room-model-ar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E" alt="" width={1} height={1} />
          Open in AR
        </a>
      )}
    </div>
  )
}

/** Safari on an iPhone or iPad says it can open AR Quick Look links */
function supportsAr(): boolean {
  try {
    return document.createElement('a').relList.supports('ar')
  } catch {
    return false
  }
}
