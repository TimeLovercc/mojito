import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowUp } from 'lucide-react-native'
import { actions } from '../api/client'
import type { HubRecord, Job, JobsList } from '../api/types'
import { useConfig } from '../config/context'
import { sourceName } from '../labels'
import { t } from '../i18n'
import { Markdown } from './RichText'
import { when } from '../time'
import { useErrorToast, useToast } from '../toast'
import { feedbackContext, trackAction } from '../usage'
import { useRefresh } from '../refresh'
import { AuthImage } from './AuthImage'
import { useImageAttach } from './ImageAttach'
import { useDesktopInput } from '../input'
import { composerD, sendArrow } from './ComposerStyle'
import { useDraft } from '../draft'
import { UndoButton } from './Undo'
import { colors, desktop, font, size } from '../theme'
import { useHub } from '../use-hub'

const POLL_MS = 3000

// 每条"我"发的消息对应的回复任务：GET /jobs 按 requested_at 倒序，同一 record_id 取最新一条
// （server 转给 Mac 时会有第二个任务，最新的那个说明现在在谁手里）
export function useChatJobs(): { byRecord: Map<string, Job>; refresh: () => Promise<void> } {
  const jobs = useHub<JobsList>('/jobs')
  const byRecord = new Map<string, Job>()
  if (jobs.data !== null) {
    for (const j of jobs.data.jobs) {
      if (j.kind === 'chat_reply' && j.record_id !== null && !byRecord.has(j.record_id)) byRecord.set(j.record_id, j)
    }
  }
  return { byRecord, refresh: jobs.refresh }
}

const isPending = (j: Job) => j.status === 'queued' || j.status === 'running'

// 有消息在等回复时，每 3 秒静默重取对话和任务
export function useReplyPolling(records: HubRecord[], byRecord: Map<string, Job>, refreshAll: () => void) {
  const waiting = records.some((r) => {
    const j = byRecord.get(r.id)
    return r.author === 'me' && j !== undefined && isPending(j)
  })
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(refreshAll, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, refreshAll])
}

function replyState(job: Job): { text: string; color: string } | null {
  if (job.status === 'done') return null
  if (job.status === 'failed') return { text: t('回复失败：{error}', { error: String(job.error) }), color: colors.bad }
  // 转给 Mac 时 agent 已写了一条"已转给 Mac"的说明，这里不再重复显示等待（design.md 8.7）
  if (job.runner === 'mac') return null
  return { text: job.status === 'queued' ? t('已排队') : t('回复中…'), color: colors.tx2 }
}

// 消息里的图片：缩略图，点开全屏看大图
export function Thumbs({ record }: { record: HubRecord }) {
  const [open, setOpen] = useState<string | null>(null)
  if (record.attachments.length === 0) return null
  return (
    <View style={styles.thumbs}>
      {record.attachments.map((a) => (
        <Pressable key={a.id} onPress={() => setOpen(a.id)}>
          <AuthImage id={a.id} style={styles.thumb} contain={false} />
        </Pressable>
      ))}
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)}>
          {open === null ? null : <AuthImage id={open} style={styles.full} contain />}
          <Text style={styles.viewerHint}>{t('点任意处关闭')}</Text>
        </Pressable>
      </Modal>
    </View>
  )
}

// 系统短消息：收起时一行标题，点开看正文；挂了事项时给"打开事项 ›"
function RouteLine({ record: r, name }: { record: HubRecord; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const more = r.body !== '' && r.body !== r.title
  const itemId = r.item_id
  return (
    <Pressable style={styles.routeWrap} onPress={() => setOpen(!open)} disabled={!more && itemId === null}>
      <Text style={styles.route} numberOfLines={open ? undefined : 1}>
        {r.title} · {name}
      </Text>
      {open && more ? <Text style={styles.routeBody}>{r.body}</Text> : null}
      {open && itemId !== null ? (
        <Text style={styles.aiLink} onPress={() => router.push({ pathname: '/items/[id]', params: { id: itemId } })}>
          {t('打开事项 ›')}
        </Text>
      ) : null}
    </Pressable>
  )
}

// 对话气泡，records 按时间正序（旧的在上）
export function ChatThread({ records, byRecord }: { records: HubRecord[]; byRecord: Map<string, Job> }) {
  const router = useRouter()
  return (
    <View style={styles.msgs}>
      {records.map((r) => {
        if (r.author === 'me') {
          const job = byRecord.get(r.id)
          const state = job === undefined ? null : replyState(job)
          return (
            <View key={r.id} style={styles.meWrap}>
              <View style={[styles.m, styles.me]}>
                <Thumbs record={r} />
                {r.body === '' ? null : <Text style={styles.meText}>{r.body}</Text>}
                <Text style={styles.meMeta}>{when(r.at)}</Text>
              </View>
              {state === null ? null : <Text style={[styles.state, { color: state.color }]}>{state.text}</Text>}
            </View>
          )
        }
        const name = sourceName(r.source)
        // agent 的 log 级消息是过程说明（如"已转给 Mac"）：一行灰字，收起看标题、点开看全文
        if (r.tier === 'log') return <RouteLine key={r.id} record={r} name={name} />
        const feedbackId = r.feedback_id
        return (
          <Pressable
            key={r.id}
            style={[styles.m, styles.ai, feedbackId !== null && styles.maintainer]}
            disabled={feedbackId === null}
            onPress={() => {
              if (feedbackId !== null) router.push({ pathname: '/feedback/[id]', params: { id: feedbackId } })
            }}
          >
            {/* 早上简报、晚间提问：正文上方标"早晚消息"（9/28 之前的简报是 quiet，没有 category） */}
            {r.category === 'brief' || r.tier === 'quiet' ? <Text style={styles.brief}>{t('早晚消息')}</Text> : null}
            {/* title 常是正文前 40 字，只有另起的标题（如"早上简报"）才单独显示 */}
            {r.body === '' || r.body.startsWith(r.title) ? null : <Text style={styles.aiTitle}>{r.title}</Text>}
            <Thumbs record={r} />
            <Markdown text={r.body === '' ? r.title : r.body} style={styles.aiText} />
            <View style={styles.aiMetaRow}>
              <Text style={styles.aiMeta}>
                {when(r.at)} · {name}
              </Text>
              <UndoButton record={r} label={t('撤销')} />
              {/* 维护会话的消息属于某条反馈，点开看完整讨论 */}
              {feedbackId === null ? null : <Text style={styles.aiLink}>{t('看讨论')}</Text>}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

// 底部输入框：POST /chat，发出即显示（onSent 把返回的记录先放进列表）
// 输入框发到哪里：对话（POST /chat）、新反馈（POST /feedback，带当前页面上下文）、回复某条反馈的讨论
export type ComposerTarget =
  | { kind: 'chat'; itemId: string | null; projectId: string | null; cardId: string | null; onSent: (r: HubRecord) => void }
  | { kind: 'feedback' }
  | { kind: 'feedback_reply'; feedbackId: string }

// 草稿按发给谁分开存（网页版冷启动恢复，见 src/draft.web.ts）
function draftKey(target: ComposerTarget): string {
  if (target.kind === 'feedback') return 'feedback'
  if (target.kind === 'feedback_reply') return `feedback:${target.feedbackId}`
  return `chat:${target.itemId}:${target.projectId}:${target.cardId}`
}

export function Composer({ target, placeholder }: { target: ComposerTarget; placeholder: string }) {
  const feedback = target.kind !== 'chat'
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const { bump } = useRefresh()
  const [text, setText] = useDraft(draftKey(target))
  const [busy, setBusy] = useState(false)
  const attach = useImageAttach(busy)
  // 先逐张 POST /attachments，再 POST /chat 带 attachment_ids；只发图时正文可以为空
  const send = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    const hub = config.hub
    const body = text.trim()
    setBusy(true)
    try {
      const ids = await attach.upload(hub)
      if (target.kind === 'feedback') {
        await actions.sendFeedback(hub, body, ids, feedbackContext())
        trackAction('feedback_send', { images: String(ids.length) })
        toast(t('反馈收到了，处理进展会出现在动态里；需要你确认的会进"等你拍板"'), false)
      } else if (target.kind === 'feedback_reply') {
        await actions.replyFeedback(hub, target.feedbackId, body, ids)
        trackAction('feedback_send', { images: String(ids.length), reply: true })
        toast(t('已发给维护会话'), false)
      } else {
        const out = await actions.sendChat(hub, body, target.itemId, target.projectId, ids, target.cardId)
        trackAction(target.itemId === null ? 'chat_send' : 'item_ask', { images: String(ids.length) })
        target.onSent(out.record)
      }
      if (target.kind !== 'chat') bump()
      setText('')
      attach.clear()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没发出去'), err)
    } finally {
      setBusy(false)
    }
  }
  const canSend = !busy && (text.trim() !== '' || attach.count > 0)
  const inputRef = useRef<TextInput>(null)
  const desk = useDesktopInput(text, () => (canSend ? send() : undefined), inputRef)
  return (
    <View>
      {attach.pending}
      {attach.chooser}
      <View
        style={
          desktop
            ? [composerD.card, styles.cardGap, feedback && { boxShadow: `0 0 0 1px ${colors.warn}` }]
            : [styles.composer, feedback && { borderColor: colors.warn }]
        }
      >
        {attach.button}
        <TextInput
          ref={inputRef}
          style={[styles.input, desk.style]}
          onKeyPress={desk.onKeyPress}
          numberOfLines={desk.numberOfLines}
          placeholder={placeholder}
          placeholderTextColor={colors.tx2}
          value={text}
          onChangeText={setText}
          multiline
          editable={!busy}
        />
        <Pressable
          accessibilityLabel={t('发送')}
          onPress={send}
          disabled={!canSend}
          style={desktop ? [composerD.send, !canSend && composerD.sendOff] : [styles.send, !canSend && { opacity: 0.4 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onBrand} />
          ) : (
            <ArrowUp size={desktop ? 16 : 18} color={desktop ? sendArrow(canSend) : colors.onBrand} strokeWidth={2.2} />
          )}
        </Pressable>
      </View>
    </View>
  )
}

// 已从 hub 拿到的消息 + 本次刚发出、还没出现在列表里的消息，按时间正序
export function mergeChat(fetched: HubRecord[], sent: HubRecord[]): HubRecord[] {
  const ids = new Set(fetched.map((r) => r.id))
  return [...fetched, ...sent.filter((r) => !ids.has(r.id))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

const styles = StyleSheet.create({
  msgs: { gap: 10 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  thumb: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.raised },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  full: { width: '100%', height: '85%' },
  viewerHint: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 10 },
  m: { maxWidth: '84%', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 16 },
  meWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '84%', gap: 3 },
  me: { maxWidth: '100%', backgroundColor: colors.brand, borderBottomRightRadius: 5 },
  // 电脑上消息正文可选中（界面其余文字不可选，desktop-css）
  meText: { ...font.regular, fontSize: size.body, color: colors.onBrand, ...(desktop ? { userSelect: 'text' as const } : {}) },
  meMeta: { ...font.regular, fontSize: size.small, color: colors.onBrand, opacity: 0.75, marginTop: 4 },
  state: { ...font.regular, fontSize: size.small },
  ai: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 5 },
  aiTitle: { ...font.semibold, fontSize: size.body, color: colors.tx, marginBottom: 2 },
  aiText: { ...font.regular, fontSize: size.body, color: colors.tx, ...(desktop ? { userSelect: 'text' as const } : {}) },
  aiMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  maintainer: { borderColor: colors.brandSoft },
  aiLink: { ...font.regular, fontSize: size.small, color: colors.brand },
  aiMeta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  // 系统类短消息（"已转给 Mac"之类）：小字灰色一行居中，不和正常回复混（design.md 8.7）
  routeWrap: { alignSelf: 'center', alignItems: 'center', gap: 4, maxWidth: '90%' },
  routeBody: { ...font.regular, fontSize: size.secondary, color: colors.tx2, textAlign: 'center' },
  brief: { ...font.regular, fontSize: size.small, color: colors.tx2, marginBottom: 2 },
  route: { ...font.regular, alignSelf: 'center', textAlign: 'center', fontSize: size.small, color: colors.tx3, paddingHorizontal: 16 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 23,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardGap: { marginHorizontal: 16, marginBottom: 16 },
  input: { ...font.regular, flex: 1, color: colors.tx, fontSize: size.body, maxHeight: 120, paddingVertical: 8 },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
})
