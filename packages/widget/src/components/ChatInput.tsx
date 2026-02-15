/**
 * Chat Input Component
 *
 * Text input with send button for the conversational widget.
 * Supports Enter to send and disabled state while loading.
 */

import { useState } from 'preact/hooks'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [text, setText] = useState('')

  function handleSubmit(e: Event) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        gap: '8px',
        padding: '12px 16px',
        borderTop: '1px solid #E4E4E7',
        backgroundColor: '#FFFFFF',
      }}
    >
      <input
        type="text"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder || 'Type your message...'}
        style={{
          flex: 1,
          padding: '10px 14px',
          border: '1px solid #E4E4E7',
          borderRadius: '8px',
          fontSize: '14px',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        style={{
          padding: '10px 20px',
          backgroundColor: disabled || !text.trim() ? '#D4D4D8' : '#09090B',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '600',
          cursor: disabled || !text.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        Send
      </button>
    </form>
  )
}
