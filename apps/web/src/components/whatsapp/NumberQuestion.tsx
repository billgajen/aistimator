'use client'

import { useState } from 'react'
import {
  MOVE_TO_BUSINESS_APP_NOTE,
  MOVE_TO_BUSINESS_APP_STEPS,
  NUMBER_APP_CHOICES,
  NUMBER_APP_QUESTION,
  PERSONAL_NUMBER_WARNING,
  PERSONAL_NUMBER_WAY_ROUND,
  mayConnect,
  type NumberApp,
} from '@/lib/whatsapp-copy'
import { ConnectWhatsApp, type ConnectSettings } from './ConnectWhatsApp'
import type { ConnectionView } from '@/lib/whatsapp-state'

/**
 * T-176: asked before Meta's window opens. A number on ordinary WhatsApp must
 * not go through: connecting it takes it off that app. The business is told
 * so, and how to move the number to the WhatsApp Business app first. Only the
 * other two answers unlock the button that opens Meta's window.
 */
export function NumberQuestion({ settings, onConnected }: { settings: ConnectSettings; onConnected: (config: ConnectionView, registrationProblem: string | null) => void }) {
  const [app, setApp] = useState<NumberApp | null>(null)
  // one-click connect is not switched on: there is no window to stand in front of
  if (!settings.available) return <ConnectWhatsApp settings={settings} onConnected={onConnected} />

  return (
    <div data-testid="number-question">
      <fieldset>
        <legend className="text-sm font-semibold text-text-primary">{NUMBER_APP_QUESTION}</legend>
        <div className="mt-2 space-y-2">
          {NUMBER_APP_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${app === choice.value ? 'border-primary bg-mint' : 'border-border bg-background'}`}
            >
              <input
                type="radio"
                name="numberApp"
                value={choice.value}
                checked={app === choice.value}
                onChange={() => setApp(choice.value)}
                className="mt-0.5 h-4 w-4 text-primary"
                data-testid={`number-app-${choice.value}`}
              />
              <span>
                <span className="block text-sm font-medium text-text-primary">{choice.label}</span>
                <span className="block text-sm text-text-secondary">{choice.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {app === 'personal' && (
        <div className="mt-4 rounded-lg border border-tertiary-line bg-surface p-4" role="alert" data-testid="personal-number-stop">
          <h3 className="text-sm font-semibold text-tertiary">Stop: move the number first</h3>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{PERSONAL_NUMBER_WARNING}</p>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">{PERSONAL_NUMBER_WAY_ROUND}</p>
          <ol className="mt-3 max-w-2xl list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            {MOVE_TO_BUSINESS_APP_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-3 max-w-2xl text-sm text-text-secondary">{MOVE_TO_BUSINESS_APP_NOTE}</p>
        </div>
      )}

      <div className="mt-4">
        <ConnectWhatsApp settings={settings} locked={!mayConnect(app)} onConnected={onConnected} />
      </div>
      {app === null && (
        <p className="mt-2 text-sm text-text-secondary" data-testid="number-question-hint">
          Choose one above to carry on. Nothing is connected until you finish Meta’s window.
        </p>
      )}
    </div>
  )
}
