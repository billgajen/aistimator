/**
 * Conversational Widget
 *
 * Chat-based interface for quote requests.
 * Gathers information naturally through conversation,
 * then submits via the same POST /api/public/quotes endpoint.
 *
 * Zero backend pipeline changes — produces the same CreateQuoteRequest.
 */

import { useState, useEffect, useRef } from 'preact/hooks'
import { ChatBubble, TypingIndicator } from './components/ChatBubble'
import { ChatInput } from './components/ChatInput'
import type { ChatMessage, ConversationState, ChatResponse, FormData, QuoteResponse } from './types'

interface ConversationalWidgetProps {
  tenantKey: string
  serviceId?: string
  apiUrl?: string
  onClose?: () => void
  onComplete?: (response: QuoteResponse) => void
  inline?: boolean
}

export function ConversationalWidget({
  tenantKey,
  serviceId,
  apiUrl,
  onClose,
  onComplete,
  inline,
}: ConversationalWidgetProps) {
  const baseUrl = apiUrl || ''
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [state, setState] = useState<ConversationState>({
    messages: [],
    extractedFields: {},
    isComplete: false,
    isLoading: true,
    selectedServiceId: serviceId,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start the conversation
  useEffect(() => {
    startConversation()
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages])

  async function startConversation() {
    try {
      const response = await fetch(`${baseUrl}/api/public/widget/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          serviceId,
          message: '__start__',
          conversationHistory: [],
        }),
      })

      if (!response.ok) {
        setError('Could not start conversation')
        setState(prev => ({ ...prev, isLoading: false }))
        return
      }

      const data: ChatResponse = await response.json()

      setState(prev => ({
        ...prev,
        isLoading: false,
        messages: [
          {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: data.reply,
            timestamp: Date.now(),
          },
        ],
        extractedFields: data.extractedFields || {},
      }))
    } catch {
      setError('Failed to connect')
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }

  async function handleSend(message: string) {
    // Add user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      isLoading: true,
    }))

    try {
      const response = await fetch(`${baseUrl}/api/public/widget/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          serviceId: state.selectedServiceId,
          message,
          conversationHistory: state.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          extractedFields: state.extractedFields,
        }),
      })

      if (!response.ok) {
        setError('Failed to get response')
        setState(prev => ({ ...prev, isLoading: false }))
        return
      }

      const data: ChatResponse = await response.json()

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: data.reply,
        timestamp: Date.now(),
      }

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        extractedFields: { ...prev.extractedFields, ...data.extractedFields },
        isComplete: data.isComplete,
        isLoading: false,
      }))

      // If conversation is complete, auto-submit the quote
      if (data.isComplete && data.formData) {
        await submitQuote(data.formData)
      }
    } catch {
      setError('Connection error')
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }

  async function submitQuote(formData: FormData) {
    setSubmitting(true)
    try {
      const response = await fetch(`${baseUrl}/api/public/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          serviceId: formData.serviceId,
          customer: formData.customer,
          job: formData.job,
          assetIds: formData.assetIds,
          source: { type: 'widget', pageUrl: window.location.href },
        }),
      })

      if (!response.ok) {
        setError('Failed to submit quote')
        setSubmitting(false)
        return
      }

      const data: QuoteResponse = await response.json()
      setSubmitted(true)
      onComplete?.(data)
    } catch {
      setError('Failed to submit quote')
    }
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '24px', fontWeight: '800', color: '#09090B', marginBottom: '12px' }}>
          Quote submitted!
        </div>
        <div style={{ fontSize: '14px', color: '#71717A', lineHeight: '1.5' }}>
          You will receive your quote shortly via email.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: inline ? '500px' : '100%',
        maxHeight: '600px',
        backgroundColor: '#FFFFFF',
        borderRadius: inline ? '12px' : undefined,
        overflow: 'hidden',
        border: inline ? '1px solid #E4E4E7' : undefined,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          borderBottom: '1px solid #E4E4E7',
          backgroundColor: '#FAFAFA',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: '700', color: '#09090B' }}>
          Get a Quote
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: '#71717A',
              padding: '4px',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {state.messages.map(msg => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {state.isLoading && <TypingIndicator />}
        {error && (
          <div style={{ padding: '8px 12px', backgroundColor: '#FEF2F2', color: '#DC2626', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' }}>
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!state.isComplete && !submitting && (
        <ChatInput
          onSend={handleSend}
          disabled={state.isLoading}
          placeholder={state.isLoading ? 'Thinking...' : 'Type your message...'}
        />
      )}

      {submitting && (
        <div style={{ padding: '16px', textAlign: 'center', color: '#71717A', fontSize: '14px' }}>
          Submitting your quote request...
        </div>
      )}
    </div>
  )
}
