'use client'

/**
 * T-197: the Help panel is an extra. If anything inside it throws while it
 * is drawn, the panel is taken away and the dashboard page behind it carries
 * on untouched: Help must never be the reason a page breaks.
 */
import { Component, type ReactNode } from 'react'

export class HelpBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    console.error('[Help] the panel could not be drawn')
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
