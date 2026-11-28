/**
 * T-210: FAKE free times, for the voice test only.
 *
 * TEST DATA. No calendar exists yet: these slots are made up by a rule (two-hour windows on
 * weekdays, from tomorrow, in the business's time zone) so that the test can hear how she offers
 * and books a time. Nothing here is a real opening, and nothing is reserved.
 *
 * Pure. Dates are civil dates in the business's time zone.
 */

/** The start hour of each made-up window (each is two hours long) */
export const TEST_SLOT_HOURS: readonly number[] = [8, 10, 13, 15]
export const TEST_SLOT_LENGTH_HOURS = 2
/** How many weekdays are offered */
export const TEST_SLOT_DAYS = 5

export interface TestSlot {
  /** `2026-11-30T08:00`: the civil date and start time in the business's time zone */
  id: string
  date: string
  weekday: string
  start: string
  end: string
  /** As she can say it: "Monday 30 November, 8 am to 10 am" */
  label: string
}

export interface TestSlots {
  testData: true
  timeZone: string
  slots: TestSlot[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Today's civil date in a time zone, as [year, month, day] */
export function civilDateIn(timeZone: string, now: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return [get('year'), get('month'), get('day')]
}

/** Whether a string names a time zone this runtime knows */
export function knownTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'am' : 'pm'}`

/** A `YYYY-MM-DD` that is a real date, as [year, month, day]; null otherwise */
export function parseCivilDate(text: unknown): [number, number, number] | null {
  if (typeof text !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? [y, mo, d] : null
}

/**
 * The made-up slots: the first `TEST_SLOT_DAYS` weekdays on or after `fromDate`, never before
 * tomorrow (in the business's time zone), four two-hour windows a day.
 */
export function testSlots(input: { fromDate?: string | null; timeZone: string; locale?: string; now?: Date }): TestSlots {
  const now = input.now ?? new Date()
  const [ty, tm, td] = civilDateIn(input.timeZone, now)
  // Civil dates are walked as UTC midnights: only the calendar matters here, not an instant
  const tomorrow = Date.UTC(ty, tm - 1, td + 1)
  const asked = parseCivilDate(input.fromDate)
  let day = Math.max(tomorrow, asked ? Date.UTC(asked[0], asked[1] - 1, asked[2]) : tomorrow)
  const slots: TestSlot[] = []
  let days = 0
  while (days < TEST_SLOT_DAYS) {
    const date = new Date(day)
    const weekdayIndex = date.getUTCDay()
    if (weekdayIndex !== 0 && weekdayIndex !== 6) {
      const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
      const weekday = new Intl.DateTimeFormat(input.locale ?? 'en-US', { timeZone: 'UTC', weekday: 'long' }).format(date)
      const dayLabel = new Intl.DateTimeFormat(input.locale ?? 'en-US', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(date)
      for (const hour of TEST_SLOT_HOURS) {
        const end = hour + TEST_SLOT_LENGTH_HOURS
        slots.push({ id: `${iso}T${pad(hour)}:00`, date: iso, weekday, start: `${pad(hour)}:00`, end: `${pad(end)}:00`, label: `${dayLabel}, ${hourLabel(hour)} to ${hourLabel(end)}` })
      }
      days += 1
    }
    day += 24 * 60 * 60 * 1000
  }
  return { testData: true, timeZone: input.timeZone, slots }
}

/** Whether a slot id is one of the made-up slots on offer now */
export function isTestSlot(slotId: unknown, input: { timeZone: string; now?: Date }): TestSlot | null {
  if (typeof slotId !== 'string') return null
  const date = parseCivilDate(slotId.slice(0, 10))
  if (!date) return null
  return testSlots({ fromDate: slotId.slice(0, 10), timeZone: input.timeZone, now: input.now }).slots.find((s) => s.id === slotId.trim()) ?? null
}
