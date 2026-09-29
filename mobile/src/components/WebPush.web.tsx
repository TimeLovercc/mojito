import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useConfig } from '../config/context'
import type { HubConfig } from '../config/store'
import { humanize } from '../errors'
import { pwa } from '../pwa'
import { colors, font, radii, size } from '../theme'
import { trackAction } from '../usage'
import { disablePush, pushSupported, registerSubscription, sameKey, vapidKey } from '../webpush'
import { Card } from './ui'
import { t } from '../i18n'

// 网页版（PWA）的推送开关（design.md 8.8、docs/api.md "开启推送"），放在"通知"页标题下，安装引导页最后一步也用它。
// Mac app（Tauri，走 /pulse）和开发网页（pwa === null）不显示
type Ready = { reg: ServiceWorkerRegistration; key: Uint8Array<ArrayBuffer>; sub: PushSubscription | null }
type State =
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'off'; ready: Ready }
  | { kind: 'renew'; ready: Ready }
  | { kind: 'on'; ready: Ready }

async function inspect(hub: HubConfig): Promise<State> {
  if (!pushSupported()) return { kind: 'unsupported' }
  if (Notification.permission === 'denied') return { kind: 'denied' }
  const [reg, key] = await Promise.all([navigator.serviceWorker.ready, vapidKey(hub)])
  const sub = await reg.pushManager.getSubscription()
  const ready = { reg, key, sub }
  if (Notification.permission === 'default') return { kind: 'off', ready }
  // 已授权：订阅在、而且是这把公钥登记的才算开着；否则要用户再点一次（iOS 没有 pushsubscriptionchange）
  return sub !== null && sameKey(sub, key) ? { kind: 'on', ready } : { kind: 'renew', ready }
}

export function WebPush() {
  const { config } = useConfig()
  if (pwa === null || config.hub === null) return null
  return <WebPushCard hub={config.hub} />
}

function WebPushCard({ hub }: { hub: HubConfig }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const check = () =>
    inspect(hub).then(setState, (err: Error) => {
      setError(t('读不到推送状态：{message}', { message: humanize(err).message }))
      setState({ kind: 'unsupported' })
    })
  useEffect(() => {
    check()
  }, [hub])

  // iOS 要求在用户点击里同步调用 subscribe：这一句之前不能有任何 await（docs/api.md "开启推送"）
  const enable = (ready: Ready) => {
    const subscribing = ready.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ready.key })
    setBusy(true)
    setError(null)
    subscribing
      .then((sub) => registerSubscription(hub, sub))
      .then(
        () => trackAction('push_enable', null),
        (err: Error) => setError(t('没开成：{message}', { message: humanize(err).message })),
      )
      .then(check)
      .finally(() => setBusy(false))
  }
  const disable = (sub: PushSubscription) => {
    setBusy(true)
    setError(null)
    disablePush(hub, sub)
      .catch((err: Error) => setError(t('没关成：{message}', { message: humanize(err).message })))
      .then(check)
      .finally(() => setBusy(false))
  }

  const ios = pwa !== null && pwa.ios
  const lines: Record<State['kind'], string> = {
    unsupported: t('这个浏览器不支持网页推送。iPhone / iPad 要 iOS 16.4 以上，并从主屏幕的 Mojito 图标打开。'),
    loading: t('正在读取推送状态…'),
    denied: ios ? t('通知被拒绝了：到 iPhone 设置 → 通知 → Mojito 里打开。') : t('通知被拒绝了：到浏览器的网站设置里允许 Mojito 发通知。'),
    off: t('还没开。开启后，下面这些类型的新消息会推到这台设备。'),
    renew: t('推送需要重新开启一次（推送密钥换过，或系统清掉了订阅）。'),
    on: t('已开启：这台设备会收到推送。'),
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{t('这台设备的推送')}</Text>
      <Text style={styles.note}>{lines[state.kind]}</Text>
      {ios ? null : <Text style={styles.note}>{t('装了 Mojito 安卓 app 或 Mac 版的设备不要开，否则每条收两份。')}</Text>}
      {error === null ? null : <Text style={[styles.note, { color: colors.bad }]}>{error}</Text>}
      {state.kind === 'off' || state.kind === 'renew' ? (
        <View style={styles.row}>
          <PushButton label={state.kind === 'off' ? t('开启推送') : t('重新开启推送')} primary disabled={busy} onClick={() => enable(state.ready)} />
        </View>
      ) : null}
      {state.kind === 'on' && state.ready.sub !== null ? (
        <View style={styles.row}>
          <PushButton label={t('关闭推送')} primary={false} disabled={busy} onClick={() => disable(state.ready.sub as PushSubscription)} />
        </View>
      ) : null}
    </Card>
  )
}

// 用原生 <button>：点击处理直接挂在 DOM click 上，iOS 一定认作用户手势（Pressable 不保证，见 内部 PWA 计划（未公开） M4）
function PushButton({ label, primary, disabled, onClick }: { label: string; primary: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        appearance: 'none',
        border: `1px solid ${primary ? colors.brand : colors.line}`,
        background: primary ? colors.brand : colors.card,
        color: primary ? colors.onBrand : colors.tx,
        borderRadius: radii.button,
        padding: '7px 14px',
        fontSize: size.secondary,
        fontWeight: 600,
        fontFamily: 'inherit',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, paddingHorizontal: 13, gap: 6 },
  row: { flexDirection: 'row', marginTop: 4 },
  name: { ...font.medium, fontSize: size.body, color: colors.tx },
  note: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
