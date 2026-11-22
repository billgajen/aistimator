import { NextResponse } from 'next/server'
import { ASK_COPY, ASK_MAX_QUESTION, type AskEvent } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { answerQuestion, askedToday, doneEvent, isConversationId, suggestionsFor, underAskLimit } from '@/lib/help/ask'
import { loadConnection } from '@/lib/whatsapp-connect'

export const dynamic = 'force-dynamic'
/** An answer is given up on at twenty seconds (ASK_TIMEOUT_MS); the function is allowed a little longer to say so */
export const maxDuration = 30

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/** Has this business a WhatsApp number connected? The row is the server's to read; it is asked for by this business's id only. */
const whatsappConnected = (tenantId: string) => async () => {
  try {
    return (await loadConnection(createAdminClient(), tenantId)) !== null
  } catch {
    return null
  }
}

/**
 * GET /api/support/ask?page=/app/services
 * Three questions to start from, chosen from the business's own state. No AI is asked.
 */
export async function GET(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const page = new URL(request.url).searchParams.get('page')
  return NextResponse.json({ suggestions: await suggestionsFor(auth.supabase, auth.tenantId, page, { whatsappConnected: whatsappConnected(auth.tenantId) }) })
}

/**
 * POST /api/support/ask  { question, conversationId, page }
 *
 * T-198: "Ask Qolumns". The answer is sent as it is written: one JSON object
 * a line, `{t:'text',v}` for each piece and a last `{t:'done',…}` that
 * carries the whole answer as it is kept, its buttons, and the question's id.
 *
 * Own business only: the state and the estimate are read through the
 * signed-in user's own client. The assistant reads and answers; this route
 * writes one row (the question) and nothing else.
 *
 * It cannot fail a page: any trouble is the answer "I couldn't answer just
 * now." with the report form offered. The limit (60 a day) is counted in the
 * database, and a count that cannot be read allows the question.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = await readJson(request)
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return fail(400, 'MISSING_QUESTION', ASK_COPY.required)
  if (question.length > ASK_MAX_QUESTION) return fail(400, 'TOO_LONG', ASK_COPY.tooLong)
  const conversationId = isConversationId(body?.conversationId) ? body.conversationId : crypto.randomUUID()

  const admin = createAdminClient()
  if (!underAskLimit(await askedToday(admin, auth.tenantId))) return fail(429, 'DAILY_LIMIT', ASK_COPY.overLimit)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: AskEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // the browser went away; the answer is still kept
          open = false
        }
      }
      const answered = await answerQuestion(
        { tenantId: auth.tenantId, userId: auth.userId, conversationId, question, page: body?.page },
        { supabase: auth.supabase, admin, whatsappConnected: whatsappConnected(auth.tenantId) },
        (piece) => send({ t: 'text', v: piece })
      )
      send(doneEvent(answered.id, answered.answer))
      try {
        controller.close()
      } catch {
        // already closed
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', 'X-Conversation-Id': conversationId },
  })
}
