/**
 * T-184: the stages between "Price this job" and the price, as they happen.
 * The same list is shown while the job is still on the phone (photos
 * uploading, waiting for a signal) and once the server is working on it, so
 * it reads as one screen from the tap to the price.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, icon, scale, space, type } from '../theme'
import type { Stage } from '../lib/pricing-stages'
import { Icon } from './ui'

export function PricingStages({ stages }: { stages: Stage[] }) {
  return (
    <View accessibilityRole="list" style={styles.list}>
      {stages.map((stage, i) => {
        const spoken = `${stage.label}${stage.note ? `, ${stage.note}` : ''}: ${stage.state === 'done' ? 'done' : stage.state === 'now' ? 'in progress' : stage.state === 'stuck' ? 'waiting' : 'not started'}`
        return (
          <View key={stage.key} style={styles.row} accessible accessibilityLabel={spoken}>
            <View style={styles.rail}>
              <View style={[styles.mark, stage.state === 'done' && styles.markDone, (stage.state === 'now' || stage.state === 'stuck') && styles.markNow]}>
                {stage.state === 'done' ? (
                  <Icon name="checkmark" size={icon.small} color={colors.white} />
                ) : stage.state === 'now' ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : stage.state === 'stuck' ? (
                  <Icon name="cloud-offline-outline" size={icon.small} color={colors.tertiary} />
                ) : null}
              </View>
              {i < stages.length - 1 ? <View style={[styles.line, stage.state === 'done' && { backgroundColor: colors.brand }]} /> : null}
            </View>
            <View style={styles.words}>
              <Text style={[styles.label, stage.state === 'next' && { color: colors.muted, fontFamily: fonts.body }]} maxFontSizeMultiplier={scale.text}>
                {stage.label}
              </Text>
              {stage.note ? (
                <Text style={styles.note} maxFontSizeMultiplier={scale.text}>
                  {stage.note}
                </Text>
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { marginTop: space.md },
  row: { flexDirection: 'row', gap: space.md, minHeight: 56 },
  rail: { alignItems: 'center', width: 32 },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  markNow: { borderColor: colors.brand, borderWidth: 2 },
  line: { flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 2 },
  words: { flex: 1, paddingTop: 5, paddingBottom: space.md },
  label: { color: colors.ink, fontFamily: fonts.semi, fontSize: type.large },
  note: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: type.small, marginTop: 2 },
})
