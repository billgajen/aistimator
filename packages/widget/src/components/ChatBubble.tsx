/**
 * Chat Bubble Component
 *
 * Renders a single message in the conversational widget.
 * Supports user and assistant messages with different styling.
 */

import type { ChatMessage } from '../types'

interface ChatBubbleProps {
  message: ChatMessage
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '12px',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          backgroundColor: isUser ? '#09090B' : '#F4F4F5',
          color: isUser ? '#FFFFFF' : '#09090B',
          fontSize: '14px',
          lineHeight: '1.5',
          wordBreak: 'break-word' as const,
        }}
      >
        {message.content}
        {message.attachmentIds && message.attachmentIds.length > 0 && (
          <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.7 }}>
            {message.attachmentIds.length} photo{message.attachmentIds.length > 1 ? 's' : ''} attached
          </div>
        )}
      </div>
    </div>
  )
}

/** Typing indicator shown while waiting for AI response */
export function TypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
      <div
        style={{
          padding: '10px 14px',
          borderRadius: '16px 16px 16px 4px',
          backgroundColor: '#F4F4F5',
          fontSize: '14px',
          color: '#71717A',
        }}
      >
        Thinking...
      </div>
    </div>
  )
}
