'use client'

import { createContext, useContext } from 'react'

/**
 * T-171: the heading level of a step's title. On the quote link page the
 * business's name is the page's h1, so a step's title is an h2; inside a
 * business's own page (the form is in a frame there) the name is an h2 and a
 * step's title an h3.
 */
export const StepHeadingLevel = createContext<'h2' | 'h3'>('h3')

export function StepTitle({ children, className = 'mb-5' }: { children: React.ReactNode; className?: string }) {
  const Tag = useContext(StepHeadingLevel)
  return <Tag className={`font-display text-xl font-bold text-text-primary ${className}`} data-testid="step-title">{children}</Tag>
}

/** T-171: a required field says so in words, not only with a red asterisk */
export function RequiredMark() {
  return <span className="font-normal text-text-secondary" data-testid="required-mark"> (required)</span>
}
