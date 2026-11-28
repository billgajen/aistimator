/**
 * T-210: who may use the voice test. One rule for the page and for both of its routes.
 *
 * It exists only while `VOICE_TEST_ENABLED=true`, and only for a platform admin (the admin area's
 * own check). For anyone else, and while it is switched off, it is not there: the answer is 404,
 * the same as for an address that never existed.
 */
import { NextResponse } from 'next/server'
import { verifyAdmin, type AdminContext } from '@/lib/admin'
import { voiceTestEnabled } from './config'

export async function voiceTestAdmin(): Promise<AdminContext | null> {
  if (!voiceTestEnabled()) return null
  return verifyAdmin()
}

export const notThere = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })
