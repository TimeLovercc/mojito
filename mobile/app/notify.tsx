import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Toggle } from '../src/components/Toggle'
import { actions } from '../src/api/client'
import { NOTIFY_KINDS, type NotifyKind, type Settings } from '../src/api/types'
import { Screen } from '../src/components/Screen'
import { Card, Rows } from '../src/components/ui'
import { WebPush } from '../src/components/WebPush'
import { useConfig } from '../src/config/context'
import { useErrorToast, useToast } from '../src/toast'
import { colors, desktop, font, size } from '../src/theme'
import { useHub } from '../src/use-hub'
import { useWide } from '../src/wide'
import { t, tc } from '../src/i18n'
export { PageError as ErrorBoundary } from '../src/components/PageError'

const LABEL: Record<NotifyKind, { name: string; note: string }> = {
  brief: { name: t('早晚消息'), note: t('早上简报、晚间提问') },
  chat: { name: t('Claude 的回复'), note: t('对话里回你、转给 Mac 后的回复') },
  alert: { name: tc('通知类型', '告警'), note: t('授权失效、数据源失联、订阅出错') },
  news: { name: t('新动态'), note: t('关注的实验室有新发布、开源、重要报告时即时报') },
  feedback: { name: t('反馈处理'), note: t('维护会话回复、已修复 / 没改') },
  release: { name: t('版本更新'), note: t('app 已更新、服务器已更新、新安装包') },
  jobs: { name: t('任务结果'), note: t('刷新完成、任务失败') },
}

// 通知（design.md 8.6）：按类型开关推送，手机推送和 Mac 通知都按它过滤；关掉只是不推，记录照常进时间线。
// 每次拨动立即 PUT /settings（带上其余设置不变）
export default function NotifyScreen() {
  const view = useHub<Settings>('/settings')
  const wide = useWide()
  return (
    // 宽屏里通知是侧栏上的一级页：顶栏写页名，不显示返回（docs/desktop-v2.md #15）
    <Screen view={view} head={wide ? { kind: 'title', title: t('通知') } : { kind: 'back', label: t('系统') }}>
      {(settings) => (
        <>
          {wide ? null : <Text style={styles.h2}>{t('通知')}</Text>}
          <WebPush />
          <Card>
            <Rows>
              {NOTIFY_KINDS.map((k) => (
                <NotifyRow key={k} kind={k} settings={settings} onSaved={view.refresh} />
              ))}
            </Rows>
          </Card>
          <Text style={styles.hint}>{t('关掉只是不推送，记录照常进时间线。')}</Text>
        </>
      )}
    </Screen>
  )
}

function NotifyRow({ kind, settings, onSaved }: { kind: NotifyKind; settings: Settings; onSaved: () => Promise<void> }) {
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  const toggle = async (on: boolean) => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.putSettings(config.hub, { ...settings, notify: { ...settings.notify, [kind]: on } })
      await onSaved()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没改成'), err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.name}>{LABEL[kind].name}</Text>
        <Text style={styles.note}>{LABEL[kind].note}</Text>
      </View>
      <Toggle value={settings.notify[kind]} disabled={busy} onChange={toggle} />
    </View>
  )
}

const styles = StyleSheet.create({
  h2: { ...font.bold, fontSize: size.page, color: colors.tx, letterSpacing: desktop ? 0 : -0.4, marginTop: 4 },
  // 电脑（docs/desktop-v2.md 逐页方案 7）：每行最小 44，标题 15 + 说明 13 tx2，右侧自绘 Toggle
  row: desktop
    ? { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 10, paddingHorizontal: 16 }
    : { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13 },
  text: { flex: 1, gap: 2 },
  name: { ...(desktop ? font.regular : font.medium), fontSize: size.body, color: colors.tx },
  note: { ...font.regular, fontSize: desktop ? size.secondary : size.small, color: colors.tx2 },
  hint: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
