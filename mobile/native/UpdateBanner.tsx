import { useEffect, useRef } from 'react'
import { AppState, Text } from 'react-native'
import * as Updates from 'expo-updates'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { bannerStyles, TopBanner, TopBanners } from '../src/components/TopBanner'
import { t } from '../src/i18n'
import { useErrorToast } from '../src/toast'

const CHECK_EVERY_MS = 30 * 60 * 1000

// 安卓 app 的新版提示（design.md 8.12，只由 NativeSetup.android.tsx 挂）：冷启动检查照旧（app.json ON_LOAD）；
// 另外每次回到前台查一次空中更新并下载（距上次查不到 30 分钟就跳过）。下载好（冷启动那次下载好也算）后顶部常驻
// "新版本已下载 · 点此重启"，不能关，点了 reloadAsync 立即换上。开发模式没有 expo-updates（isEnabled 为 false），不查也不显示
export function UpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates()
  const insets = useSafeAreaInsets()
  const showError = useErrorToast()
  // 冷启动刚查过，从现在起算
  const checkedAt = useRef(Date.now())

  useEffect(() => {
    if (!Updates.isEnabled) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - checkedAt.current < CHECK_EVERY_MS) return
      checkedAt.current = Date.now()
      Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync().then(() => undefined) : undefined))
        .catch((err: Error) => console.warn(`查空中更新失败：${err.message}`))
    })
    return () => sub.remove()
  }, [])

  if (!isUpdatePending) return null
  return (
    <TopBanners top={insets.top + 6}>
      <TopBanner onPress={() => Updates.reloadAsync().catch((err: Error) => showError(t('重启失败'), err))}>
        <Text style={bannerStyles.text}>{t('新版本已下载 · 点此重启')}</Text>
      </TopBanner>
    </TopBanners>
  )
}
