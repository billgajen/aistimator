/**
 * T-199: the Worker that serves businesses' own addresses (yourname.<our
 * domain>). Settings: wrangler.addresses.toml. Everything it does is in
 * src/address-handler.ts; this file is only the entry, and exports nothing
 * but the handler (the Workers runtime refuses an entry file that exports
 * anything else).
 */
import { handleAddress, type AddressDeps, type AddressEnv } from './address-handler'

type DataCentreCache = NonNullable<AddressDeps['cache']>

export default {
  async fetch(request: Request, env: AddressEnv): Promise<Response> {
    const store = (globalThis as unknown as { caches?: { default?: DataCentreCache } }).caches?.default
    return handleAddress(request, env, { fetch: (input, init) => fetch(input, init), cache: store ?? null })
  },
}
