import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Toggle } from '../src/components/Toggle'
import { useRouter } from 'expo-router'
import { actions } from '../src/api/client'
import type { Subscription, SubscriptionsList } from '../src/api/types'
import { Screen } from '../src/components/Screen'
import { Btn, Card, Empty, Rows } from '../src/components/ui'
import { useConfig } from '../src/config/context'
import { useRefresh } from '../src/refresh'
import { when } from '../src/time'
import { useErrorToast, useToast } from '../src/toast'
import { colors, desktop, font, size } from '../src/theme'
import { useHub } from '../src/use-hub'
import { t } from '../src/i18n'

const healthColor = { ok: colors.ok, warn: colors.warn, error: colors.bad } as const

// 订阅（design.md 8.5、8.10）：信息流从哪里来——每日 AI 简报、实验室动态（每 8 小时查一次）、每日邮件。
// 这里只有开关；改时间、改关注什么（实验室名单），点"调整"进对话说一句，Claude 改。名称由 hub 按语言给
export default function SubscriptionsScreen() {
  const view = useHub<SubscriptionsList>('/subscriptions')
  const router = useRouter()
  const openChat = () => router.push('/chat')
  return (
    <Screen view={view} head={{ kind: 'back', label: t('信息流') }}>
      {({ subscriptions }) => (
        <>
          <Text style={styles.h2}>{t('订阅')}</Text>
          {subscriptions.length === 0 ? (
            <Empty text={t('还没有订阅')} />
          ) : (
            <Card>
              <Rows>
                {subscriptions.map((s) => (
                  <SubRow key={s.id} sub={s} onAdjust={openChat} />
                ))}
              </Rows>
            </Card>
          )}
          <Text style={styles.hint}>
            {t('改时间、改关注什么（比如"实验室名单加上 Mistral"），点"调整"在对话里说一句。')}
          </Text>
        </>
      )}
    </Screen>
  )
}

function SubRow({ sub, onAdjust }: { sub: Subscription; onAdjust: () => void }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  // 只读展示：实验室动态的名单
  const labs = sub.kind === 'watch' ? (sub.config.labs as string[]) : null

  const toggle = async (enabled: boolean) => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.setSubscriptionEnabled(config.hub, sub.id, enabled)
      toast(enabled ? t('「{name}」打开了', { name: sub.name }) : t('「{name}」关掉了，时间线里可以撤销', { name: sub.name }), false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没改成'), err)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setRunning(true)
    try {
      await actions.runSubscription(config.hub, sub.id)
      toast(t('「{name}」已开始，跑完进信息流', { name: sub.name }), false)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没开始'), err)
    } finally {
      setRunning(false)
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <Text style={[styles.name, !sub.enabled && { color: colors.tx2 }]}>{sub.name}</Text>
        <Text style={styles.at}>
          {sub.kind === 'watch' ? t('每 {n} 小时', { n: sub.config.every_hours as number }) : t('每天 {at}', { at: sub.at })}
        </Text>
        <View style={{ flex: 1 }} />
        <Toggle value={sub.enabled} disabled={busy} onChange={toggle} />
      </View>
      {labs === null ? null : <Text style={styles.meta}>{t('实验室：{labs}', { labs: labs.join(t('、')) })}</Text>}
      <View style={styles.top}>
        {sub.health === null ? null : <View style={[styles.dot, { backgroundColor: healthColor[sub.health] }]} />}
        <Text style={styles.meta} numberOfLines={2}>
          {sub.last_run_at === null ? t('还没跑过') : `${when(sub.last_run_at)} · ${sub.last_result === null ? t('没有结果') : sub.last_result}`}
        </Text>
        <View style={{ flex: 1 }} />
        <Btn label={t('现在跑')} disabled={running} onPress={run} />
        <Btn label={t('调整')} onPress={onAdjust} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  h2: { ...font.bold, fontSize: size.page, color: colors.tx, letterSpacing: desktop ? 0 : -0.4, marginTop: 4 },
  row: { paddingVertical: 11, paddingHorizontal: 13, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...font.semibold, fontSize: size.title, color: colors.tx },
  at: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hint: { ...font.regular, fontSize: size.small, color: colors.tx2 },
})
