'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { OwnAddressCard } from '@/components/share/OwnAddressCard'
import type { AddressView } from '@/lib/own-address'

/** T-199: Home's "Choose your own address" card. "Later" hides it here (it stays on the Quote link page); once chosen it is gone. */
export function HomeAddressCard({ view }: { view: AddressView }) {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  if (hidden || !view.canChoose || view.later) return null
  return (
    <OwnAddressCard
      view={view}
      place="home"
      onLater={() => setHidden(true)}
      onChosen={() => {
        setHidden(true)
        router.push('/app/quote-link')
      }}
    />
  )
}
