import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { colors, font, size } from '../theme'

// 窗口顶部浮着的横幅（品牌色、最宽 420、居中）：网页版的"有新版本 · 点此刷新""刚收到"，Mac app 的"新版已装好 · 点此重启"
export function TopBanners({ top, children }: { top: number; children: ReactNode }) {
  return (
    <View style={[styles.banners, { top }]} pointerEvents="box-none">
      {children}
    </View>
  )
}

export function TopBanner({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <Pressable style={styles.banner} onPress={onPress}>
      {children}
    </Pressable>
  )
}

export const bannerStyles = StyleSheet.create({
  text: { ...font.semibold, fontSize: size.secondary, color: colors.onBrand, flex: 1 },
  close: { ...font.semibold, fontSize: size.title, color: colors.onBrand },
})

const styles = StyleSheet.create({
  banners: { position: 'absolute', left: 12, right: 12, zIndex: 100, gap: 6, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 420,
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.brand,
  },
})
