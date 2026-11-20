/**
 * T-194: a room scan arriving from the business app, for a new quote
 * (POST /api/app/quotes) or scanned again on a quote already priced
 * (POST /api/app/quotes/:id/scan). One place decides:
 *   - that the business's plan includes room scan (Pro and Business): the
 *     server refuses a scan from a business without it;
 *   - which answers the scan fills, in the order of trust (AD-028,
 *     `mergeScanAnswers`): a number the business typed is kept, the scan fills
 *     what was left blank. Only `{ fieldId, value }` is stored.
 *
 * Pure apart from the plan lookup.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeScanAnswers, scanAnswers, ROOM_SCAN_FIELD, type ExpectedSignalConfig, type RoomScanPayload, type ServiceDraftConfig } from '@qolumns/shared'
import { hasPlanFeature } from '@/lib/plan-features'

type Answer = { fieldId: string; value: unknown }

/** What the app is told when the plan has no room scan (no price, no link: the app says it is part of Pro) */
export const SCAN_NOT_IN_PLAN = { code: 'ROOM_SCAN_NOT_IN_PLAN', message: 'Room scan is part of Pro.' } as const

/** Does this business's plan include room scan? (No live plan: no.) */
export async function planHasRoomScan(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  return hasPlanFeature(supabase, tenantId, 'lidar_scanning')
}

export interface ScanService {
  expected_signals?: ExpectedSignalConfig[] | null
  draft_config?: ServiceDraftConfig | null
}

function fills(scan: RoomScanPayload, service: ScanService | null) {
  return scanAnswers({
    scan,
    expectedSignals: service?.expected_signals || [],
    fields: service?.draft_config?.suggestedFields || [],
    existingAnswers: [],
  })
}

/** The answers to store with a new quote: what was typed, what the scan fills, and the scan itself */
export function answersWithScan(answers: readonly Answer[], scan: RoomScanPayload, service: ScanService | null): Answer[] {
  const typed = answers.filter((a) => a.fieldId !== ROOM_SCAN_FIELD)
  const merged = mergeScanAnswers(typed, fills(scan, service)).answers
  return [...merged, { fieldId: ROOM_SCAN_FIELD, value: scan }]
}

/**
 * A quote's answers with its scan replaced by a new one (the area scanned again, or an area added).
 * What the old scan filled goes (an answer equal to the old scan's figure was the scan's, not typed);
 * what the business typed stays and still wins; the new scan fills the rest.
 */
export function answersWithNewScan(jobAnswers: readonly Answer[], oldScan: RoomScanPayload | null, scan: RoomScanPayload, service: ScanService | null): Answer[] {
  const oldFills = oldScan ? fills(oldScan, service) : []
  const typed = jobAnswers.filter((a) => {
    if (a.fieldId === ROOM_SCAN_FIELD) return false
    const fill = oldFills.find((f) => f.fieldId === a.fieldId)
    return !fill || Number(String(a.value).replace(/,/g, '')) !== fill.value
  })
  return answersWithScan(typed, scan, service)
}
