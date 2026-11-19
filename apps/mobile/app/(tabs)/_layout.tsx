/**
 * T-184: three tabs at the bottom. Quotes (what needs me now), New quote in
 * the centre as the main action, Account. The bar clears the home indicator,
 * each tab is a wide target for a thumb, and the centre one stands proud of
 * the bar so it is found without looking.
 */
import { StyleSheet, View } from 'react-native'
import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../../src/components/ui'
import { useOutbox, useOutboxState } from '../../src/lib/outbox-context'
import { colors, fonts, icon } from '../../src/theme'

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const outbox = useOutbox()
  useOutboxState() // the mark on New quote follows the unfinished quote
  const drafts = outbox.mine()
  const unfinished = drafts.some((d) => d.send === 'editing' && (d.serviceId || d.photos.length > 0))
  const waiting = drafts.filter((d) => d.send !== 'editing').length

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semi, fontSize: 12 },
        tabBarAllowFontScaling: false,
        tabBarStyle: {
          height: 62 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: colors.white,
          borderTopColor: colors.line,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Quotes',
          tabBarAccessibilityLabel: waiting > 0 ? `Quotes. ${waiting} waiting to send` : 'Quotes',
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent, fontFamily: fonts.bold },
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'documents' : 'documents-outline'} size={icon.tab} color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="new"
        options={{
          title: unfinished ? 'Carry on' : 'New quote',
          tabBarAccessibilityLabel: unfinished ? 'New quote. Carry on with the unfinished quote' : 'New quote',
          tabBarIcon: () => (
            <View style={styles.centre}>
              <Icon name="add" size={icon.large} color={colors.white} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarAccessibilityLabel: 'Account',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'person-circle' : 'person-circle-outline'} size={icon.tab} color={String(color)} />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  // the main action: a juniper disc that rises above the bar (never yellow: no button in the app is)
  centre: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.white,
  },
})
