/**
 * T-184: a fault inside a screen never shows a program's error text. The
 * screen is replaced by a plain sentence and a way to carry on; a quote being
 * written is on the phone already (the sending queue), so nothing is lost.
 */
import { Component, type ReactNode } from 'react'
import { View } from 'react-native'
import { Button, EmptyState } from './ui'
import { colors } from '../theme'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    // nothing is written anywhere: a message could carry a customer's details
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.paper }}>
        <EmptyState icon="refresh" title="Something went wrong" text="Nothing was lost. A quote you were writing is saved on this phone.">
          <Button title="Try again" onPress={() => this.setState({ failed: false })} />
        </EmptyState>
      </View>
    )
  }
}
