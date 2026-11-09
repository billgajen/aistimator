import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { formatMoney, type QuoteListItem } from '@estimator/shared'
import { useApi } from '../src/lib/api-context'
import { statusLabel } from '../src/lib/price'
import { supabase } from '../src/lib/supabase'
import { Button, ErrorText, Muted, Screen } from '../src/components/ui'
import { colors, space } from '../src/theme'

export default function Quotes() {
  const api = useApi()
  const router = useRouter()
  const [items, setItems] = useState<QuoteListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems((await api.listQuotes()).items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load quotes')
    } finally {
      setLoading(false)
    }
  }, [api])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  return (
    <Screen>
      <FlatList
        contentContainerStyle={{ padding: space.lg }}
        data={items}
        keyExtractor={(q) => q.quoteId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        ListHeaderComponent={
          <View style={{ marginBottom: space.lg }}>
            <Button title="New on-site quote" onPress={() => router.push('/new')} />
            {error ? <ErrorText>{error}</ErrorText> : null}
          </View>
        }
        ListEmptyComponent={loading ? undefined : <Muted>No quotes yet.</Muted>}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/quote/${item.quoteId}`)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.customerName}</Text>
              <Muted>
                {item.serviceName} · {statusLabel(item.status)}
              </Muted>
            </View>
            <Text style={styles.total}>{item.total > 0 ? formatMoney(item.total, item.currency) : '—'}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ marginTop: space.xl }}>
            <Button title="Sign out" variant="secondary" onPress={() => supabase.auth.signOut()} />
          </View>
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  name: { color: colors.ink, fontWeight: '600', fontSize: 16 },
  total: { color: colors.ink, fontVariant: ['tabular-nums'], fontWeight: '600' },
})
