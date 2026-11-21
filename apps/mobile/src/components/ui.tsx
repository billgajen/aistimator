/**
 * Small shared UI pieces: plain React Native, no UI kit.
 *
 * Built for one hand on site (T-182): the main button of a screen sits in a
 * bar at the bottom, where a thumb reaches; anything pressed is at least
 * 44 px and the rows and buttons a trade uses most are 56 px and more;
 * controls are never closer than 8 px. Colours, sizes and faces come from
 * theme.ts (Docs/design/system.md decides them).
 *
 * T-184: the three brand faces, one icon set (Ionicons), a light tap on main
 * actions, text that follows the phone's text-size setting, and a spoken
 * label on every control.
 */
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, fonts, icon, radius, scale, space, tabular, touch, type } from '../theme'
import { tap, useReduceMotion } from '../lib/feel'
import type { ToneStyle } from '../lib/status'

export type IconName = ComponentProps<typeof Ionicons>['name']

/** One icon. Decoration unless it is given a label: the words beside it are what is read out. */
export function Icon({ name, size = icon.row, color = colors.ink, label }: { name: IconName; size?: number; color?: string; label?: string }) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={Boolean(label)}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no'}
      accessibilityElementsHidden={!label}
    />
  )
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

/**
 * The top of a tab's screen: its title in the display face, under the status
 * bar. Drawn by the screen itself (the tabs have no navigation header), so
 * nothing a screen shows can sit under a header.
 */
export function TopBar({ title, note, right, children }: { title: string; note?: string | null; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + space.md }]}>
      <View style={styles.topBarRow}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={styles.topBarTitle} maxFontSizeMultiplier={scale.large} numberOfLines={2}>
            {title}
          </Text>
          {note ? (
            <Text style={styles.topBarNote} maxFontSizeMultiplier={scale.text}>
              {note}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title} maxFontSizeMultiplier={scale.large}>
      {children}
    </Text>
  )
}

/** A card's or a group's heading */
export function Label({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.label} maxFontSizeMultiplier={scale.text}>
      {children}
    </Text>
  )
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.body, style]} maxFontSizeMultiplier={scale.text}>
      {children}
    </Text>
  )
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.muted, style]} maxFontSizeMultiplier={scale.text}>
      {children}
    </Text>
  )
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
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={help}
        placeholderTextColor={colors.muted}
        maxFontSizeMultiplier={scale.large}
        style={[styles.input, props.multiline && styles.inputLong, style]}
        {...input}
      />
      {help ? <Muted>{help}</Muted> : null}
    </View>
  )
}

/** `dangerText` is a small red text button for something that removes (it still asks before it does) */
type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerText'

export function Button(props: {
  title: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  variant?: ButtonVariant
  note?: string
  icon?: IconName
  /** What a screen reader says, when the title alone is not enough */
  label?: string
}) {
  const variant = props.variant ?? 'primary'
  const off = props.disabled || props.busy
  const textColor = variant === 'primary' ? colors.white : variant === 'danger' || variant === 'dangerText' ? colors.danger : colors.brand
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label ?? (props.note ? `${props.title}. ${props.note}` : props.title)}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(props.busy) }}
      onPress={() => {
        // a light tap on a screen's main action; quieter buttons stay silent
        if (variant === 'primary') tap()
        props.onPress()
      }}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        variant === 'dangerText' && styles.buttonDangerText,
        off && { opacity: 0.45 },
        pressed && variant === 'primary' && { backgroundColor: colors.brandPressed },
        pressed && variant !== 'primary' && { backgroundColor: colors.mint },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          <View style={styles.buttonRow}>
            {props.icon ? <Icon name={props.icon} size={icon.row} color={textColor} /> : null}
            <Text style={[styles.buttonText, variant === 'dangerText' && styles.buttonTextSmall, { color: textColor }]} maxFontSizeMultiplier={scale.large}>
              {props.title}
            </Text>
          </View>
          {props.note ? (
            <Text style={[styles.buttonNote, { color: textColor }]} maxFontSizeMultiplier={scale.large}>
              {props.note}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  )
}

/** The bar at the bottom of a screen: the one main action, within reach of a thumb */
export function BottomBar({ children, inTabs }: { children: ReactNode; inTabs?: boolean }) {
  const insets = useSafeAreaInsets()
  // inside the tabs the tab bar already clears the home indicator
  return <View style={[styles.bottomBar, { paddingBottom: inTabs ? space.md : Math.max(insets.bottom, space.md) }]}>{children}</View>
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
            accessibilityLabel={o.label}
            accessibilityState={props.multiple ? { checked: on } : { selected: on }}
            onPress={() => props.onChange(o.value)}
            style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { backgroundColor: colors.mint }]}
          >
            <View style={[styles.rowMark, props.multiple && { borderRadius: radius.sm }, on && styles.rowMarkOn]}>
              {on ? <Icon name="checkmark" size={16} color={colors.white} /> : null}
            </View>
            <Text style={[styles.rowText, on && { fontFamily: fonts.bold }]} maxFontSizeMultiplier={scale.text}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A row that opens something: an icon, a title, a second line, a chevron */
export function LinkRow(props: { title: string; note?: string | null; icon?: IconName; onPress: () => void; label?: string; danger?: boolean; last?: boolean }) {
  const tint = props.danger ? colors.danger : colors.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label ?? (props.note ? `${props.title}. ${props.note}` : props.title)}
      onPress={props.onPress}
      style={({ pressed }) => [styles.linkRow, !props.last && styles.linkRowLine, pressed && { backgroundColor: colors.mint }]}
    >
      {props.icon ? <Icon name={props.icon} color={props.danger ? colors.danger : colors.brand} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.linkRowTitle, { color: tint }]} maxFontSizeMultiplier={scale.text}>
          {props.title}
        </Text>
        {props.note ? <Muted style={{ marginTop: 2 }}>{props.note}</Muted> : null}
      </View>
      {props.danger ? null : <Icon name="chevron-forward" size={icon.small} color={colors.muted} />}
    </Pressable>
  )
}

/** T-196: a setting that is on or off. The whole row is the switch's label; 44 pt tall at least. */
export function SwitchRow(props: { title: string; note?: string | null; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; last?: boolean }) {
  return (
    <View style={[styles.linkRow, !props.last && styles.linkRowLine]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.linkRowTitle, { color: props.disabled ? colors.muted : colors.ink }]} maxFontSizeMultiplier={scale.text}>
          {props.title}
        </Text>
        {props.note ? <Muted style={{ marginTop: 2 }}>{props.note}</Muted> : null}
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={props.note ? `${props.title}. ${props.note}` : props.title}
        accessibilityState={{ checked: props.value, disabled: props.disabled === true }}
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ false: colors.lineStrong, true: colors.brand }}
        ios_backgroundColor={colors.lineStrong}
      />
    </View>
  )
}

/** A status in words, coloured by whose turn it is */
export function Pill({ label, tone }: { label: string; tone: ToneStyle }) {
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }, tone.border ? { borderWidth: 1, borderColor: tone.border } : null]}>
      {tone.marker ? <View style={styles.pillMarker} /> : null}
      <Text style={[styles.pillText, { color: tone.text }]} maxFontSizeMultiplier={scale.large}>
        {label}
      </Text>
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
      <Text style={[styles.noticeText, { color: danger ? colors.danger : colors.ink }]} maxFontSizeMultiplier={scale.text}>
        {children}
      </Text>
    </View>
  )
}

export function ProgressBar({ fraction, label }: { fraction: number; label?: string }) {
  const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  const width = `${Math.round(safe * 100)}%` as const
  return (
    <View
      style={styles.progressTrack}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Progress'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(safe * 100) }}
    >
      <View style={[styles.progressFill, { width }]} />
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={styles.error} maxFontSizeMultiplier={scale.text}>
      {children}
    </Text>
  )
}

/** A money row: words on the left, the figure on the right in the figure face */
export function MoneyRow({ label, amount, note, strong }: { label: string; amount: string; note?: string | null; strong?: boolean }) {
  return (
    <View style={styles.moneyRow} accessible accessibilityLabel={`${label}, ${amount}${note ? `, ${note}` : ''}`}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={[styles.moneyLabel, strong && { fontFamily: fonts.bold }]} maxFontSizeMultiplier={scale.text}>
          {label}
        </Text>
        {note ? <Muted>{note}</Muted> : null}
      </View>
      <Text style={[styles.figure, strong && { fontFamily: fonts.figureBold, fontVariant: tabular }]} maxFontSizeMultiplier={scale.large}>
        {amount}
      </Text>
    </View>
  )
}

/**
 * A grey block standing in for content that is loading. It breathes gently;
 * with Reduce Motion on it is still.
 */
export function Skeleton({ width = '100%', height = 16, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  const still = useReduceMotion()
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (still) {
      opacity.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [still, opacity])
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.skeleton, { width, height, opacity }, style]} />
}

/** An empty place with something to do about it */
export function EmptyState({ icon: name, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark}>
        <Icon name={name} size={icon.large} color={colors.brand} />
      </View>
      <Text accessibilityRole="header" style={styles.emptyTitle} maxFontSizeMultiplier={scale.large}>
        {title}
      </Text>
      <Text style={styles.emptyText} maxFontSizeMultiplier={scale.text}>
        {text}
      </Text>
      {children}
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topBar: { paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  topBarTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  topBarNote: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.small, marginTop: 2 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, letterSpacing: -0.3, marginBottom: space.md },
  label: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.body, marginBottom: space.sm },
  body: { color: colors.ink, fontFamily: fonts.body, fontSize: type.body, lineHeight: 23 },
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: type.small, marginTop: space.xs, lineHeight: 20 },
  input: {
    minHeight: touch.row,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: fonts.body,
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
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.field },
  buttonQuiet: { minHeight: touch.min, backgroundColor: 'transparent' },
  // still a 44 px target, but it takes only the room its words need
  buttonDangerText: { minHeight: touch.min, alignSelf: 'center', backgroundColor: 'transparent', paddingVertical: space.sm },
  buttonTextSmall: { fontFamily: fonts.semi, fontSize: type.small },
  buttonText: { fontFamily: fonts.bold, fontSize: type.large, textAlign: 'center' },
  buttonNote: { fontFamily: fonts.body, fontSize: type.note, marginTop: 2, textAlign: 'center' },
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
  rowText: { flex: 1, color: colors.ink, fontFamily: fonts.body, fontSize: type.large },
  linkRow: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  linkRowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  linkRowTitle: { fontFamily: fonts.semi, fontSize: type.body },
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
  pillText: { fontFamily: fonts.semi, fontSize: type.small },
  notice: { borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  noticeText: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: type.body, marginVertical: space.sm },
  moneyRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.sm },
  moneyLabel: { color: colors.ink, fontFamily: fonts.body, fontSize: type.body },
  figure: { color: colors.ink, fontFamily: fonts.figure, fontVariant: tabular, fontSize: type.body },
  skeleton: { backgroundColor: colors.line, borderRadius: radius.sm },
  empty: { alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.xl * 2, gap: space.sm },
  emptyMark: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  emptyTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: type.title, textAlign: 'center' },
  emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.body, lineHeight: 23, textAlign: 'center', marginBottom: space.md },
})
