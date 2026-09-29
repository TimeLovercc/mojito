import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, Mail, MessageSquare, X } from 'lucide-react-native'
import { actions } from '../api/client'
import type { Draft } from '../api/types'
import { useConfig } from '../config/context'
import { useRefresh } from '../refresh'
import { when } from '../time'
import { useErrorToast, useToast } from '../toast'
import { trackAction } from '../usage'
import { colors, font, size } from '../theme'
import { Btn, Card, Consequences } from './ui'
import { t, tc } from '../i18n'

// agent 起草的对外消息。app 永远不替用户发送：只能复制正文、到原渠道自己发，再标"我已发出"，或者"不要"
export function DraftCard({ draft }: { draft: Draft }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const Icon = draft.channel === 'email' ? Mail : MessageSquare

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(draft.body)
      trackAction('draft_copy', { channel: draft.channel })
      toast(t('正文已复制，去原渠道发出后回来点"我已发出"'), false)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('复制失败'), err)
    }
  }
  const resolve = async (status: 'dismissed' | 'sent_by_me') => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.resolveDraft(config.hub, draft.id, status)
      trackAction('draft_resolve', { status, channel: draft.channel })
      toast(status === 'sent_by_me' ? t('已记为你发出了') : t('草稿已放下'), false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('失败'), err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Icon size={14} color={colors.warn} />
        <Text style={styles.to} numberOfLines={1}>
          {draft.channel === 'email' ? t('邮件草稿 → {to}', { to: draft.to }) : t('消息草稿 → {to}', { to: draft.to })}
        </Text>
      </View>
      {draft.subject === null ? null : <Text style={styles.subject}>{draft.subject}</Text>}
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Text style={styles.body} numberOfLines={open ? undefined : 4}>
          {draft.body}
        </Text>
        <Text style={styles.meta}>
          {when(draft.at)} · {draft.source} · {open ? t('收起') : t('点开看全文')}
        </Text>
      </Pressable>
      <Consequences lines={[t('app 不会替你发送：复制正文，到原渠道自己发'), t('我已发出：记下你已经发了'), t('不要：放下这份草稿')]} />
      <View style={styles.btns}>
        <Btn label={t('复制正文')} icon={Copy} onPress={copy} />
        <Btn label={t('我已发出')} primary icon={Check} disabled={busy} onPress={() => resolve('sent_by_me')} />
        <Btn label={tc('草稿', '不要')} danger icon={X} disabled={busy} onPress={() => resolve('dismissed')} />
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingVertical: 11, paddingHorizontal: 13, gap: 6, borderLeftWidth: 3, borderLeftColor: colors.warn },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  to: { ...font.regular, fontSize: size.secondary, color: colors.tx2, flex: 1 },
  subject: { ...font.semibold, fontSize: size.body, color: colors.tx },
  body: { ...font.regular, fontSize: size.secondary, color: colors.tx },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 3 },
  btns: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 2 },
})
