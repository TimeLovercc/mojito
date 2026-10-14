import { useEffect, useState } from 'react'
import { Text } from 'react-native'
import { usePathname } from 'expo-router'
import { bannerStyles, TopBanner, TopBanners } from '../components/TopBanner'
import { t } from '../i18n'
import type { TauriApi } from '../tauri-api'
import { useErrorToast } from '../toast'

// Mac app 的新版提示（design.md 8.4"新版提示"）：壳在新版装好后每 30 秒发一次 update-ready（payload 是新版本号），
// 收到就在主窗口顶部常驻"新版已装好 · 点此重启"，不能关；点了 invoke('relaunch') 重启到新版。
// 菜单栏面板也会收到这个事件，但面板不显示横幅
export function UpdateBanner({ bridge }: { bridge: TauriApi }) {
  const menubar = usePathname() === '/menubar'
  const [version, setVersion] = useState<string | null>(null)
  const showError = useErrorToast()
  useEffect(() => {
    const off = bridge.event.listen<string>('update-ready', (e) => setVersion(e.payload))
    return () => {
      off.then((stop) => stop())
    }
  }, [bridge])
  if (menubar || version === null) return null
  const relaunch = () =>
    bridge.core.invoke<null>('relaunch', {}).catch((err: string) => showError(t('重启失败'), new Error(err)))
  return (
    // 顶栏高 52：横幅（约 38 高）放在顶栏中间，不挡页面内容
    <TopBanners top={7}>
      <TopBanner onPress={relaunch}>
        <Text style={bannerStyles.text}>{t('新版已装好 · 点此重启')}</Text>
      </TopBanner>
    </TopBanners>
  )
}
