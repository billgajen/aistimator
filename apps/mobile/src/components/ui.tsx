/** Small shared UI pieces — plain React Native, no UI kit dependency. */
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { colors, radius, space } from '../theme'

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>
}

export function Field(props: TextInputProps & { label: string; help?: string }) {
  const { label, help, style, ...input } = props
  return (
    <View style={{ marginBottom: space.md }}>
      <Label>{label}</Label>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...input} />
      {help ? <Muted>{help}</Muted> : null}
    </View>
  )
}

export function Button(props: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'secondary' }) {
  const secondary = props.variant === 'secondary'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        (props.disabled || props.busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={secondary ? colors.brand : colors.white} />
      ) : (
        <Text style={[styles.buttonText, secondary && { color: colors.brand }]}>{props.title}</Text>
      )}
    </Pressable>
  )
}

export function Choice(props: { options: Array<{ value: string; label: string }>; value?: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {props.options.map((o) => {
        const selected = props.value === o.value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => props.onChange(o.value)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && { color: colors.white }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  label: { color: colors.ink, fontWeight: '600', marginBottom: space.xs },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonSecondary: { backgroundColor: colors.mint },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.ink },
  error: { color: colors.danger, marginVertical: space.sm },
})
