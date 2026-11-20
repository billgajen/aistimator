'use client'

import { useEffect, useState } from 'react'
import { RoomModelViewer } from '@/components/room-scan/RoomModelViewer'
import { modelSourceAllowed } from '@/lib/room-model-source'

/** The model's address and the area's name, from the part of the page address after "#" */
export function ModelPage({ storageHost }: { storageHost: string }) {
  const [model, setModel] = useState<{ src: string; name: string } | null | 'refused'>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const src = params.get('src') ?? ''
    const name = (params.get('name') ?? '').slice(0, 60) || 'the area'
    setModel(modelSourceAllowed(src, { storageHost, pageOrigin: window.location.origin }) ? { src, name } : 'refused')
  }, [storageHost])
  return (
    <main className="flex h-[100dvh] flex-col bg-ink text-white">
      <h1 className="px-4 pb-2 pt-4 text-base font-semibold">{model && model !== 'refused' ? `3D model of ${model.name}` : '3D model'}</h1>
      {model === 'refused' && <p className="px-4 text-sm">This model could not be opened. Open it again from the quote.</p>}
      {model && model !== 'refused' && (
        <div className="min-h-0 flex-1">
          <RoomModelViewer src={model.src} roomName={model.name} fullPage />
        </div>
      )}
    </main>
  )
}
