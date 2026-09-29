import { useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { hubRequest } from '../api/client'
import { useConfig } from '../config/context'
import { humanize } from '../errors'
import { pwa } from '../pwa'
import '../viewport'
import { colors, font, radii, size } from '../theme'
import { Btn, Card } from './ui'
import { WebPush } from './WebPush'
import { SW_SCOPE, SW_URL } from '../webpush'
import { t } from '../i18n'

// 网页版一加载就注册 Service Worker（scope /app/）：引导页最后一步开推送要等它就绪
if (pwa !== null && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' })
    .catch((err: Error) => console.warn(`Service Worker 注册失败：${err.message}`))
}

// 网页版（PWA）的安装引导（design.md 8.8"怎么装"、docs/api.md "安装说明页"）：
// iPhone / iPad 的浏览器标签页里只显示安装说明（标签页和主屏 app 的存储是分开的，这里填的令牌主屏 app 读不到）；
// 主屏 app、电脑浏览器、安卓 Chrome：没有令牌时先填令牌，再开推送，然后进 app。
// Mac app 和开发网页（pwa === null）不经过这里
export function PwaGate({ children }: { children: ReactNode }) {
  const { config } = useConfig()
  // 启动时没有令牌才走引导；填完令牌还要停在"开推送"这一步，等用户点"开始使用"
  const [onboarding, setOnboarding] = useState(config.hub === null)
  if (pwa === null) return children
  if (pwa.ios && !pwa.standalone) return <Page><InstallGuide /></Page>
  if (!onboarding && config.hub !== null) return children
  return (
    <Page>
      {config.hub === null ? <TokenStep /> : <PushStep onDone={() => setOnboarding(false)} />}
    </Page>
  )
}

function Page({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Mojito</Text>
      {children}
    </ScrollView>
  )
}

function InstallGuide() {
  const steps = [
    t('点"分享"。iOS 26 的紧凑布局下，"分享"在地址栏旁的"⋯"里。'),
    t('在分享菜单里往下滑，点"添加到主屏幕"。'),
    t('保持"作为网页 App 打开"开着，名字是 Mojito，点"添加"。'),
    t('回到主屏幕，点 Mojito 图标打开，在那里粘贴令牌、开启推送。'),
  ]
  return (
    <>
      <Text style={styles.lead}>{t('先把 Mojito 添加到主屏幕，再从主屏幕的图标打开。')}</Text>
      <Card style={styles.card}>
        {steps.map((s, i) => (
          <Text key={s} style={styles.step}>
            {i + 1}. {s}
          </Text>
        ))}
      </Card>
      <Text style={styles.note}>
        {t('在浏览器标签页里不能填令牌：iPhone 上主屏 app 和浏览器的存储是分开的，这里填的令牌主屏 app 读不到。Safari、Chrome、Edge 都可以添加。')}
      </Text>
    </>
  )
}

function TokenStep() {
  const { update } = useConfig()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 先用这个令牌取一次设置，确认 hub 认它，再存下
  const save = async () => {
    const hub = { hubUrl: window.location.origin, token: token.trim() }
    setBusy(true)
    setError(null)
    try {
      await hubRequest(hub, 'GET', '/settings')
      await update({ hub, orcaUrl: null })
      // 请浏览器别在存储紧张时清掉令牌和缓存
      await navigator.storage.persist()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      setError(humanize(err).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Text style={styles.lead}>{t('粘贴这台设备专用的 app 令牌。')}</Text>
      <Card style={styles.card}>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder={t('app 令牌')}
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        {error === null ? null : <Text style={[styles.note, { color: colors.bad }]}>{error}</Text>}
        <View style={styles.row}>
          <Btn label={busy ? t('检查中…') : t('保存')} primary disabled={busy || token.trim() === ''} onPress={save} />
        </View>
      </Card>
      <Text style={styles.note}>{t('令牌在 Mac 上用 add-app-token.sh 生成，只显示一次。它只存在这个 app 自己的存储里，删掉主屏图标就清除。')}</Text>
      {pwa !== null && pwa.ios ? null : (
        <Text style={styles.note}>{t('安卓 Chrome 也可以装成 app：菜单 → 安装应用（或"添加到主屏幕"）。')}</Text>
      )}
    </>
  )
}

function PushStep({ onDone }: { onDone: () => void }) {
  return (
    <>
      <Text style={styles.lead}>{t('令牌已保存。最后一步：开启推送，新消息会推到这台设备。以后也可以在"系统 → 通知"里开关。')}</Text>
      <WebPush />
      <View style={styles.row}>
        <Btn label={t('开始使用')} primary onPress={onDone} />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, gap: 14, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  lead: { ...font.medium, fontSize: size.body, color: colors.tx },
  card: { paddingVertical: 12, paddingHorizontal: 13, gap: 8 },
  step: { ...font.regular, fontSize: size.body, color: colors.tx, lineHeight: Math.round(size.body * 1.5) },
  note: { ...font.regular, fontSize: size.small, color: colors.tx2, lineHeight: Math.round(size.small * 1.5) },
  row: { flexDirection: 'row' },
  input: {
    ...font.regular,
    fontSize: size.body,
    color: colors.tx,
    backgroundColor: colors.raised,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
})
