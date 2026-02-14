import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/public/widget/chat
 *
 * Conversational widget endpoint. Uses Gemini 2.5 Flash to drive a
 * chat-based quote intake, extracting structured field values from
 * natural language. Produces the same CreateQuoteRequest when complete.
 */

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

interface ChatRequestBody {
  tenantKey: string
  serviceId?: string
  message: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  extractedFields?: Record<string, string | number | boolean | null>
}

interface ExtractedFields {
  [key: string]: string | number | boolean
}

interface ChatAPIResponse {
  reply: string
  extractedFields: ExtractedFields
  nextQuestion?: string
  isComplete: boolean
  formData?: {
    serviceId: string
    customer: { name: string; email: string; phone?: string }
    job: {
      address?: string
      postcodeOrZip?: string
      answers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
    }
    assetIds: string[]
  }
}

export async function POST(request: Request) {
  try {
    const body: ChatRequestBody = await request.json()

    if (!body.tenantKey) {
      return NextResponse.json(
        { error: { code: 'MISSING_TENANT_KEY', message: 'tenantKey is required' } },
        { status: 400 }
      )
    }

    if (!body.message) {
      return NextResponse.json(
        { error: { code: 'MISSING_MESSAGE', message: 'message is required' } },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Validate tenant
    const { data: tenantSite, error: siteError } = await supabase
      .from('tenant_sites')
      .select('tenant_id, is_active')
      .eq('tenant_key', body.tenantKey)
      .single()

    if (siteError || !tenantSite) {
      return NextResponse.json(
        { error: { code: 'INVALID_TENANT_KEY', message: 'Invalid or unknown tenant key' } },
        { status: 400 }
      )
    }

    if (!tenantSite.is_active) {
      return NextResponse.json(
        { error: { code: 'TENANT_INACTIVE', message: 'This tenant is not active' } },
        { status: 403 }
      )
    }

    const tenantId = tenantSite.tenant_id

    // Load tenant info
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()

    // Load active services
    const { data: services } = await supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name')

    // Load widget fields (global + service-specific)
    const { data: widgetConfigs } = await supabase
      .from('widget_configs')
      .select('service_id, config_json')
      .eq('tenant_id', tenantId)

    type FieldConfig = {
      fieldId: string
      label: string
      type: string
      required: boolean
      serviceId?: string | null
      criticalForPricing?: boolean
      options?: Array<{ value: string; label: string }>
    }
    type ConfigJson = { fields?: FieldConfig[] }

    const allFields: FieldConfig[] = []
    for (const cfg of widgetConfigs || []) {
      const configJson = cfg.config_json as ConfigJson | null
      if (!configJson?.fields) continue
      for (const field of configJson.fields) {
        // Include global fields and fields matching selected service
        if (!field.serviceId || field.serviceId === body.serviceId) {
          allFields.push(field)
        }
      }
      // Also include service-specific config fields
      if (cfg.service_id === body.serviceId && configJson.fields) {
        for (const field of configJson.fields) {
          if (!allFields.some(f => f.fieldId === field.fieldId)) {
            allFields.push(field)
          }
        }
      }
    }

    const serviceList = (services || []).map(s => `- ${s.name} (ID: ${s.id})`).join('\n')
    const selectedService = body.serviceId
      ? (services || []).find(s => s.id === body.serviceId)
      : null

    const fieldDescriptions = allFields.map(f => {
      let desc = `- ${f.label} (fieldId: "${f.fieldId}", type: ${f.type}`
      if (f.required) desc += ', REQUIRED'
      if (f.criticalForPricing) desc += ', CRITICAL FOR PRICING'
      if (f.options) desc += `, options: ${f.options.map(o => o.label).join(', ')}`
      desc += ')'
      return desc
    }).join('\n')

    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) {
      return NextResponse.json(
        { error: { code: 'AI_UNAVAILABLE', message: 'AI service not configured' } },
        { status: 503 }
      )
    }

    // Build the system prompt for Gemini
    const isStart = body.message === '__start__'

    const systemPrompt = `You are a friendly quote assistant for "${tenant?.name || 'our business'}".
Your job is to gather information for a quote request through natural conversation.

AVAILABLE SERVICES:
${serviceList}
${selectedService ? `\nSELECTED SERVICE: ${selectedService.name}` : '\nNo service selected yet — ask the customer which service they need.'}

INFORMATION TO COLLECT:
1. Customer name (REQUIRED)
2. Customer email (REQUIRED)
3. Customer phone (optional)
${!selectedService ? '4. Which service they need (REQUIRED)\n' : ''}${fieldDescriptions ? `\nSERVICE-SPECIFIC FIELDS:\n${fieldDescriptions}` : ''}

RULES:
- Be conversational and helpful, not robotic
- Ask one or two questions at a time, not all at once
- When the customer provides info, acknowledge it naturally
- Extract field values from their responses — include ALL fields collected so far in extractedFields, not just new ones from this message
- When you have all REQUIRED information (name + email + project description at minimum), set isComplete to true
- When isComplete is true, you MUST include ALL collected fields in extractedFields (customerName, customerEmail, etc.)
- Do NOT make up information the customer hasn't provided
- Keep responses concise (2-3 sentences max)

${(() => {
  const ef = body.extractedFields
  if (!ef || Object.keys(ef).length === 0) return ''
  const collected = Object.entries(ef)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n')
  return collected ? `ALREADY COLLECTED FROM PREVIOUS MESSAGES:\n${collected}\n\nUse these values in your extractedFields output. If the customer corrects any, use the new value.\n` : ''
})()}
${isStart ? 'This is the start of the conversation. Greet the customer warmly and ask your first question.' : ''}`

    // Build conversation messages for Gemini
    const geminiMessages: Array<{ role: string; parts: Array<{ text: string }> }> = []

    // Add conversation history
    for (const msg of body.conversationHistory) {
      geminiMessages.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }

    // Add current user message (skip for __start__)
    if (!isStart) {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: body.message }],
      })
    } else {
      // For start, send a trigger message
      geminiMessages.push({
        role: 'user',
        parts: [{ text: 'Hi, I would like to get a quote.' }],
      })
    }

    // Response schema for structured output
    const responseSchema = {
      type: 'OBJECT',
      properties: {
        reply: { type: 'STRING', description: 'Your conversational response to the customer' },
        extractedFields: {
          type: 'OBJECT',
          properties: {
            customerName: { type: 'STRING', nullable: true },
            customerEmail: { type: 'STRING', nullable: true },
            customerPhone: { type: 'STRING', nullable: true },
            serviceId: { type: 'STRING', nullable: true },
            address: { type: 'STRING', nullable: true },
            postcodeOrZip: { type: 'STRING', nullable: true },
          },
          description: 'Fields extracted from this message. Only include fields the customer explicitly provided.',
        },
        fieldAnswers: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              fieldId: { type: 'STRING' },
              value: { type: 'STRING' },
            },
            required: ['fieldId', 'value'],
          },
          description: 'Service-specific field values extracted from conversation',
        },
        isComplete: {
          type: 'BOOLEAN',
          description: 'True only when ALL required information has been collected: customer name, email, and service selection at minimum.',
        },
      },
      required: ['reply', 'extractedFields', 'isComplete'],
    }

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiMessages,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7,
          response_mime_type: 'application/json',
          response_schema: responseSchema,
        },
      }),
    })

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      console.error('[Chat] Gemini API error:', geminiResponse.status, errorText)

      if (geminiResponse.status === 429) {
        return NextResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Please try again in a moment' } },
          { status: 429 }
        )
      }

      return NextResponse.json(
        { error: { code: 'AI_ERROR', message: 'Failed to generate response' } },
        { status: 500 }
      )
    }

    const geminiData = await geminiResponse.json()
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    let parsed: {
      reply: string
      extractedFields: ExtractedFields
      fieldAnswers?: Array<{ fieldId: string; value: string }>
      isComplete: boolean
    }

    try {
      parsed = JSON.parse(rawText)
    } catch {
      // Fallback: treat raw text as reply
      console.error('[Chat] Failed to parse Gemini response:', rawText.slice(0, 200))
      return NextResponse.json({
        reply: rawText || "I'm sorry, I had trouble understanding. Could you try again?",
        extractedFields: {},
        isComplete: false,
      })
    }

    // Build response
    const result: ChatAPIResponse = {
      reply: parsed.reply,
      extractedFields: parsed.extractedFields || {},
      isComplete: parsed.isComplete,
    }

    // If complete, assemble formData for submission
    if (parsed.isComplete) {
      const ef = parsed.extractedFields || {}
      const resolvedServiceId = (ef.serviceId as string) || body.serviceId

      if (resolvedServiceId && ef.customerName && ef.customerEmail) {
        const answers: Array<{ fieldId: string; value: string | number | boolean | string[] }> = []
        if (parsed.fieldAnswers) {
          for (const fa of parsed.fieldAnswers) {
            answers.push({ fieldId: fa.fieldId, value: fa.value })
          }
        }

        result.formData = {
          serviceId: resolvedServiceId,
          customer: {
            name: ef.customerName as string,
            email: ef.customerEmail as string,
            phone: ef.customerPhone as string | undefined,
          },
          job: {
            address: ef.address as string | undefined,
            postcodeOrZip: ef.postcodeOrZip as string | undefined,
            answers,
          },
          assetIds: [],
        }
      } else {
        // Missing required fields — not actually complete
        result.isComplete = false
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Chat] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
