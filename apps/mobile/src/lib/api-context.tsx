import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createApi, type Api } from './api'
import { config } from './config'
import { getAccessToken } from './supabase'

const ApiContext = createContext<Api | null>(null)

export function ApiProvider({ children }: { children: ReactNode }) {
  const api = useMemo(
    () =>
      createApi({
        baseUrl: config.apiUrl,
        getAccessToken,
        readFile: async (uri) => (await fetch(uri)).blob(),
      }),
    []
  )
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside ApiProvider')
  return api
}
