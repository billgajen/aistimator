/**
 * Small shared UI pieces — plain React Native, no UI kit dependency.
 *
 * Built for one hand on site (T-182): the main button of a screen sits in a
 * bar at the bottom, where a thumb reaches; anything pressed is at least
 * 44 px and the rows and buttons a trade uses most are 56 px and more;
 * controls are never closer than 8 px. Colours and sizes come from theme.ts
 * (Docs/design/system.md decides them).
 */
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius, space, touch, type } from '../theme'
import type { ToneStyle } from '../lib/status'

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>
}

/** "(required)" and "(optional)" are said in words, never by a mark alone */
export function fieldLabel(label: string, need?: 'required' | 'optional'): string {
  return need ? `${label} (${need})` : label
}

export function Field(props: TextInputProps & { label: string; help?: string }) {
  const { label, help, style, ...input } = props
  return (
    <View style={{ marginBottom: space.lg }}>
      <Label>{label}</Label>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={[styles.input, props.multiline && styles.inputLong, style]} {...input} />
      {help ? <Muted>{help}</Muted> : null}
    </View>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

export function Button(props: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: ButtonVariant; note?: string }) {
  const variant = props.variant ?? 'primary'
  const off = props.disabled || props.busy
  const textColor = variant === 'primary' ? colors.white : variant === 'danger' ? colors.danger : colors.brand
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(props.busy) }}
      onPress={props.onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        off && { opacity: 0.45 },
        pressed && variant === 'primary' && { backgroundColor: colors.brandPressed },
        pressed && variant !== 'primary' && { backgroundColor: colors.mint },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          <Text style={[styles.buttonText, { color: textColor }]}>{props.title}</Text>
          {props.note ? <Text style={[styles.buttonNote, { color: textColor }]}>{props.note}</Text> : null}
        </>
      )}
    </Pressable>
  )
}

/** The bar at the bottom of a screen: the one main action, within reach of a thumb */
export function BottomBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>{children}</View>
}

export interface RowOption {
  value: string
  label: string
}

/**
 * A question answered by tapping a row. One row can be on (`value` a string)
 * or several (`value` a list). Each row is 56 px high and says whether it is
 * on in words as well as colour.
 */
export function Rows(props: { options: RowOption[]; value?: string | string[]; multiple?: boolean; onChange: (value: string) => void }) {
  const isOn = (v: string) => (Array.isArray(props.value) ? props.value.includes(v) : props.value === v)
  return (
    <View style={{ gap: space.sm }} accessibilityRole={props.multiple ? undefined : 'radiogroup'}>
      {props.options.map((o) => {
        const on = isOn(o.value)
        return (
          <Pressable
            key={o.value}
            accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
            accessibilityState={props.multiple ? { checked: on } : { selected: on }}
            onPress={() => props.onChange(o.value)}
            style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { backgroundColor: colors.mint }]}
          >
            <View style={[styles.rowMark, props.multiple && { borderRadius: radius.sm }, on && styles.rowMarkOn]}>
              {on ? <Text style={styles.rowTick}>✓</Text> : null}
            </View>
            <Text style={[styles.rowText, on && { fontWeight: '700' }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A status in words, coloured by whose turn it is */
export function Pill({ label, tone }: { label: string; tone: ToneStyle }) {
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }, tone.border ? { borderWidth: 1, borderColor: tone.border } : null]}>
      {tone.marker ? <View style={styles.pillMarker} /> : null}
      <Text style={[styles.pillText, { color: tone.text }]}>{label}</Text>
    </View>
  )
}

/** A notice the business should read: a warning edge, never yellow or butter */
export function Notice({ children, tone = 'notice' }: { children: ReactNode; tone?: 'notice' | 'danger' }) {
  const danger = tone === 'danger'
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: danger ? colors.danger : colors.tertiary, backgroundColor: danger ? colors.dangerLight : colors.white }]}
    >
      <Text style={[styles.noticeText, { color: danger ? colors.danger : colors.ink }]}>{children}</Text>
    </View>
  )
}

export function ProgressBar({ fraction }: { fraction: number }) {
  const width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` as const
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.progressFill, { width }]} />
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {children}
    </Text>
  )
}

/** A money row: words on the left, the figure on the right in tabular numbers */
export function MoneyRow({ label, amount, note, strong }: { label: string; amount: string; note?: string | null; strong?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={[styles.moneyLabel, strong && { fontWeight: '700' }]}>{label}</Text>
        {note ? <Muted>{note}</Muted> : null}
      </View>
      <Text style={[styles.figure, strong && { fontWeight: '700' }]}>{amount}</Text>
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '800', marginBottom: space.md },
  label: { color: colors.ink, fontWeight: '600', fontSize: type.body, marginBottom: space.sm },
  muted: { color: colors.muted, fontSize: type.small, marginTop: space.xs, lineHeight: 20 },
  input: {
    minHeight: touch.row,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: type.large,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputLong: { minHeight: 112, textAlignVertical: 'top' },
  button: {
    minHeight: touch.main,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.field },
  buttonQuiet: { minHeight: touch.min, backgroundColor: 'transparent' },
  buttonText: { fontWeight: '700', fontSize: type.large, textAlign: 'center' },
  buttonNote: { fontSize: type.note, marginTop: 2, textAlign: 'center' },
  bottomBar: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  row: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  rowOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.mint },
  rowMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  rowMarkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  rowTick: { color: colors.white, fontWeight: '800', fontSize: type.small, lineHeight: 18 },
  rowText: { flex: 1, color: colors.ink, fontSize: type.large },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  pillMarker: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onAccent },
  pillText: { fontSize: type.small, fontWeight: '600' },
  notice: { borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  noticeText: { fontSize: type.body, lineHeight: 22 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  error: { color: colors.danger, fontSize: type.body, marginVertical: space.sm },
  moneyRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.sm },
  moneyLabel: { color: colors.ink, fontSize: type.body },
  figure: { color: colors.ink, fontSize: type.body, fontVariant: ['tabular-nums'] },
})
