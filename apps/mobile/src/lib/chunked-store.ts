/**
 * T-182: a key-value store that splits a long value into parts.
 *
 * The sign-in is kept in the phone's keychain (expo-secure-store), which is
 * meant for short values: a value over about 2,000 bytes may not be stored,
 * and a signed-in session is longer than that. Without this the app can sign
 * in and then ask again the next time it is opened.
 *
 * Pure: the store is handed in.
 */

export interface KeyValue {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** Comfortably under the keychain's limit, counting characters that take several bytes */
export const CHUNK_CHARS = 900

const MARK = '__parts__:'
const partKey = (key: string, index: number) => `${key}.${index}`

function partCount(stored: string | null): number {
  if (!stored || !stored.startsWith(MARK)) return 0
  const n = Number(stored.slice(MARK.length))
  return Number.isInteger(n) && n > 0 && n < 100 ? n : 0
}

export function chunkedStore(base: KeyValue, chunkChars = CHUNK_CHARS): KeyValue {
  async function removeParts(key: string, from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) await base.removeItem(partKey(key, i))
  }

  return {
    async getItem(key) {
      const head = await base.getItem(key)
      const count = partCount(head)
      // a short value, or one saved before this existed, is stored whole
      if (count === 0) return head
      let value = ''
      for (let i = 0; i < count; i++) {
        const part = await base.getItem(partKey(key, i))
        if (part === null) return null // half a value is no value
        value += part
      }
      return value
    },

    async setItem(key, value) {
      const before = partCount(await base.getItem(key))
      if (value.length <= chunkChars && !value.startsWith(MARK)) {
        await base.setItem(key, value)
        await removeParts(key, 0, before)
        return
      }
      const parts: string[] = []
      for (let i = 0; i < value.length; i += chunkChars) parts.push(value.slice(i, i + chunkChars))
      for (let i = 0; i < parts.length; i++) await base.setItem(partKey(key, i), parts[i]!)
      // the count is written last: a value is only read once every part is there
      await base.setItem(key, `${MARK}${parts.length}`)
      await removeParts(key, parts.length, before)
    },

    async removeItem(key) {
      const count = partCount(await base.getItem(key))
      await base.removeItem(key)
      await removeParts(key, 0, count)
    },
  }
}
