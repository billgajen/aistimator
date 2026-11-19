/**
 * T-184: one of the customer's photos, full screen. Swipe between them,
 * pinch to look closer, and close with the button or a swipe down.
 *
 * The photos are the ones the quote screen just showed (photo-viewer.ts):
 * short-lived signed addresses, so a photo left open for many minutes may
 * need the quote opened again.
 */
import { useState } from 'react'
import { Dimensions, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { viewerPhotos } from '../src/lib/photo-viewer'
import { toNumber } from '../src/lib/numbers'
import { Icon } from '../src/components/ui'
import { fonts, icon, scale, space, touch, type } from '../src/theme'

export default function PhotoViewer() {
  const { index } = useLocalSearchParams<{ index?: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const photos = viewerPhotos()
  const { width, height } = Dimensions.get('window')
  const first = Math.max(0, Math.min(photos.length - 1, Math.floor(toNumber(index))))
  const [at, setAt] = useState(first)
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {photos.length === 0 ? (
        <View style={styles.centre}>
          <Text style={styles.message}>This photo is no longer here. Go back and open the quote again.</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          initialScrollIndex={first}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (
            // pinch to look closer (the phone's own zoom)
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={styles.page}
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
            >
              {failed[item.id] ? (
                <Text style={styles.message}>This photo could not be loaded. Go back and open the quote again.</Text>
              ) : (
                <Image
                  source={{ uri: item.url }}
                  style={{ width, height: height - insets.top - insets.bottom - 2 * touch.row }}
                  resizeMode="contain"
                  accessible
                  accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                  accessibilityIgnoresInvertColors
                  onError={() => setFailed((f) => ({ ...f, [item.id]: true }))}
                />
              )}
            </ScrollView>
          )}
        />
      )}

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        {photos.length > 1 ? (
          <Text style={styles.count} maxFontSizeMultiplier={scale.large} accessibilityLiveRegion="polite">
            {at + 1} of {photos.length}
          </Text>
        ) : (
          <View />
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Close the photo" onPress={() => router.back()} hitSlop={12} style={styles.close}>
          <Icon name="close" size={icon.tab} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // a photo is looked at on black, whatever the app's colours are
  screen: { flex: 1, backgroundColor: '#000000' },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  message: { color: '#FFFFFF', fontFamily: fonts.body, fontSize: type.body, textAlign: 'center', padding: space.xl },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  count: { color: '#FFFFFF', fontFamily: fonts.figure, fontSize: type.body },
  close: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
