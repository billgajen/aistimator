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
  fieldAnswers?: Array<{ fieldId: string; value: string }>
}

interface ExtractedFields {
  [key: string]: string | number | boolean
}

interface ChatAPIResponse {
  reply: string
  extractedFields: ExtractedFields
  fieldAnswers?: Array<{ fieldId: string; value: string }>
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

      if (cfg.service_id === null) {
        // Global config — include fields that are truly global (no serviceId)
        // or scoped to the selected service via field.serviceId property
        for (const field of configJson.fields) {
          if (!field.serviceId || field.serviceId === body.serviceId) {
            allFields.push(field)
          }
        }
      } else if (cfg.service_id === body.serviceId) {
        // Service-specific config matching the selected service — include all fields
        for (const field of configJson.fields) {
          if (!allFields.some(f => f.fieldId === field.fieldId)) {
            allFields.push(field)
          }
        }
      }
      // Skip service-specific configs for OTHER services entirely
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

    // Build list of required fields the AI must collect
    const requiredFields = allFields.filter(f => f.required).map(f => f.label)
    const requiredFieldIds = allFields.filter(f => f.required).map(f => f.fieldId)

    // Build "already collected" context from both extractedFields and fieldAnswers
    const collectedLines: string[] = []
    const ef = body.extractedFields
    if (ef) {
      for (const [k, v] of Object.entries(ef)) {
        if (v !== null && v !== undefined && v !== '') {
          collectedLines.push(`  - ${k}: ${v}`)
        }
      }
    }
    const prevFieldAnswers = body.fieldAnswers || []
    for (const fa of prevFieldAnswers) {
      const field = allFields.find(f => f.fieldId === fa.fieldId)
      collectedLines.push(`  - ${field?.label || fa.fieldId} (fieldId: ${fa.fieldId}): ${fa.value}`)
    }

    // Figure out which required fields are still missing
    const collectedFieldIds = new Set(prevFieldAnswers.map(fa => fa.fieldId))
    const missingRequired = allFields
      .filter(f => f.required && !collectedFieldIds.has(f.fieldId))
      .map(f => f.label)

    const systemPrompt = `You are a friendly quote assistant for "${tenant?.name || 'our business'}".
Your job is to gather information for a quote request through natural conversation.

AVAILABLE SERVICES:
${serviceList}
${selectedService ? `\nSELECTED SERVICE: ${selectedService.name} (ID: ${selectedService.id})` : '\nNo service selected yet — help the customer choose one. As soon as you identify which service they want, set extractedFields.serviceId to the exact service ID shown above (e.g., svc_xxx). Do NOT wait until the end — set it on the SAME turn you identify the service.'}

INFORMATION TO COLLECT:
1. Customer name (REQUIRED)
2. Customer email (REQUIRED)
3. Customer phone (optional)
${!selectedService ? '4. Which service they need (REQUIRED)\n' : ''}${fieldDescriptions ? `\nSERVICE-SPECIFIC FIELDS TO ASK ABOUT:\n${fieldDescriptions}` : ''}

${collectedLines.length > 0 ? `ALREADY COLLECTED FROM PREVIOUS MESSAGES:\n${collectedLines.join('\n')}\n\nInclude these in your extractedFields/fieldAnswers output. If the customer corrects any, use the new value.\n` : ''}
${missingRequired.length > 0 ? `STILL NEEDED (ask about these):\n${missingRequired.map(f => `  - ${f}`).join('\n')}\n` : ''}

COMPLETION RULES:
- Set isComplete to true ONLY when you have ALL of the following:
  * Customer name
  * Customer email
  ${selectedService ? '' : '* Service selection'}
  ${requiredFields.length > 0 ? `* ALL required service fields: ${requiredFields.join(', ')}` : ''}
- If you are still missing ANY required field, set isComplete to false and ask for it
- The fieldAnswers array must contain ALL service-specific field values collected so far (not just new ones)

CONVERSATION RULES:
- Be conversational and helpful, not robotic
- Ask one or two questions at a time, not all at once
- When the customer provides info, acknowledge it naturally
- For select/dropdown fields, present the options naturally
- For boolean fields (yes/no), ask naturally
- Do NOT make up information the customer hasn't provided
- Keep responses concise (2-3 sentences max)
- A project description from the customer should go into the fieldAnswers with fieldId "_project_description"
- IMPORTANT: Only ask questions relevant to the SELECTED service. Never ask about other services' fields.
- When a service is identified, IMMEDIATELY set extractedFields.serviceId to its ID. Do not delay this.

${isStart ? 'This is the start of the conversation. Greet the customer warmly and ask about their project first, then collect the specific fields one by one.' : ''}`

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
          maxOutputTokens: 2000,
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

    // Include fieldAnswers in response so client can accumulate them
    if (parsed.fieldAnswers && parsed.fieldAnswers.length > 0) {
      result.fieldAnswers = parsed.fieldAnswers
    }

    // If complete, assemble formData for submission
    if (parsed.isComplete) {
      const completedFields = parsed.extractedFields || {}
      const resolvedServiceId = (completedFields.serviceId as string) || body.serviceId

      if (resolvedServiceId && completedFields.customerName && completedFields.customerEmail) {
        // Merge accumulated fieldAnswers from previous turns with new ones
        const answerMap = new Map<string, string>()
        // Previous accumulated answers
        for (const fa of prevFieldAnswers) {
          answerMap.set(fa.fieldId, fa.value)
        }
        // New answers from this turn (override if same fieldId)
        if (parsed.fieldAnswers) {
          for (const fa of parsed.fieldAnswers) {
            answerMap.set(fa.fieldId, fa.value)
          }
        }

        const answers: Array<{ fieldId: string; value: string | number | boolean | string[] }> = []
        for (const [fieldId, value] of answerMap) {
          answers.push({ fieldId, value })
        }

        // Verify all required fields are present
        const hasAllRequired = requiredFieldIds.every(fid => answerMap.has(fid))
        if (!hasAllRequired && requiredFieldIds.length > 0) {
          // Missing required service fields — not actually complete
          result.isComplete = false
        } else {
          result.formData = {
            serviceId: resolvedServiceId,
            customer: {
              name: completedFields.customerName as string,
              email: completedFields.customerEmail as string,
              phone: completedFields.customerPhone as string | undefined,
            },
            job: {
              address: completedFields.address as string | undefined,
              postcodeOrZip: completedFields.postcodeOrZip as string | undefined,
              answers,
            },
            assetIds: [],
          }
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
