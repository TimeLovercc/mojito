import { useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, ChevronRight, Laptop, X } from 'lucide-react-native'
import type { HubRecord, Job } from '../api/types'
import { useChatData, useServerStatus, type ChatAbout } from '../components/ChatPane'
import { Composer, Thumbs } from '../components/Chat'
import { Markdown } from '../components/RichText'
import { StaleBanner } from '../components/Screen'
import { UndoButton } from '../components/Undo'
import { t } from '../i18n'
import { sourceName } from '../labels'
import { clock, greeting } from '../time'
import { colors, font, overlay, size } from '../theme'
import { fadeTop, hoverGroup } from '../web-data'
import { HoverMeta } from './HoverMeta'
import { TopBarD, useScrolled } from './TopBar'
import { dt } from './tokens'
import { BtnD } from './ui'

// 电脑对话整页（docs/desktop-v2.md 逐页方案 6、内部界面稿（未公开） 第 2 节）：720 居中；AI 回复不套气泡；
// 我的消息是 fill 气泡；系统短消息是一行灰字，点开看全文；元信息悬停才出现（最后一条和带撤销的常驻）。
// 空状态是宋体问候 + 居中的输入卡。context：从别的页带来的"正在看"，显示成输入卡里的芯片
export function ChatWide({ about, context, onClearContext }: { about: ChatAbout; context: ReactNode | null; onClearContext: () => void }) {
  const status = useServerStatus()
  const { view, records, byRecord, loadOlder, canLoadOlder, addSent } = useChatData()
  const [scrolled, onScroll] = useScrolled()
  const scroll = useRef<ScrollView>(null)
  // 在底部时新消息来了跟着滚到底；往上翻时不打扰
  const atBottom = useRef(true)
  const empty = view.data !== null && records.length === 0

  const composer = (
    <Composer
      target={{
        kind: 'chat',
        ...about,
        onSent: (r) => {
          atBottom.current = true
          addSent(r)
        },
      }}
      placeholder={empty ? t('说点什么…') : t('发消息…')}
      chips={
        context === null ? null : (
          <Pressable style={styles.chip} onPress={onClearContext} accessibilityLabel={t('不带这个上下文')}>
            <Text style={styles.chipText} numberOfLines={1}>
              {context}
            </Text>
            <X size={14} color={colors.tx3} strokeWidth={1.8} />
          </Pressable>
        )
      }
    />
  )

  return (
    <View style={styles.page}>
      <TopBarD
        title={t('对话')}
        sub={
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: status.bad ? colors.bad : colors.ok }]} />
            <Text style={styles.statusText}>{status.text}</Text>
          </View>
        }
        back={null}
        tools={null}
        column={dt.width.chat}
        scrolled={scrolled && !empty}
      />
      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.display}>{greeting()}</Text>
          <View style={styles.column}>{composer}</View>
        </View>
      ) : (
        <>
          <View style={styles.scrollWrap}>
            <ScrollView
              ref={scroll}
              contentContainerStyle={styles.scroll}
              onScroll={(e) => {
                onScroll(e)
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
                atBottom.current = contentOffset.y + layoutMeasurement.height > contentSize.height - 60
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (atBottom.current) scroll.current?.scrollToEnd({ animated: false })
              }}
            >
              <View style={styles.column}>
                <StaleBanner view={view} />
                {canLoadOlder ? (
                  <View style={styles.older}>
                    <BtnD
                      label={t('更早的')}
                      kind="ghost"
                      size="sm"
                      onPress={() => loadOlder(() => (atBottom.current = false))}
                      disabled={false}
                    />
                  </View>
                ) : null}
                <ThreadD records={records} byRecord={byRecord} />
              </View>
            </ScrollView>
            <View style={styles.fade} {...fadeTop} />
          </View>
          <View style={styles.foot}>
            <View style={styles.column}>{composer}</View>
          </View>
        </>
      )}
    </View>
  )
}

// 消息流：换人时间距 24，同一人连续 8
function ThreadD({ records, byRecord }: { records: HubRecord[]; byRecord: Map<string, Job> }) {
  const lastAi = [...records].reverse().find((r) => r.author !== 'me')
  return (
    <View>
      {records.map((r, i) => {
        const prev = i === 0 ? null : records[i - 1]
        const gap = prev === null ? 0 : (prev.author === 'me') === (r.author === 'me') ? dt.space.chatSame : dt.space.chatTurn
        return (
          <View key={r.id} style={{ marginTop: gap }}>
            {r.author === 'me' ? (
              <Mine record={r} job={byRecord.get(r.id)} />
            ) : r.tier === 'log' ? (
              <LogLine record={r} last={r === lastAi} />
            ) : (
              <Reply record={r} last={r === lastAi} />
            )}
          </View>
        )
      })}
    </View>
  )
}

// AI 回复：没有气泡、边框、头像，Markdown 16/26，最宽 680，可以选中；下面 12 tx3 操作条
function Reply({ record: r, last }: { record: HubRecord; last: boolean }) {
  const router = useRouter()
  const feedbackId = r.feedback_id
  return (
    <View style={styles.ai} {...hoverGroup}>
      {r.category === 'brief' || r.tier === 'quiet' ? <Text style={styles.label}>{t('早晚消息')}</Text> : null}
      <Thumbs record={r} />
      <Markdown text={r.body === '' ? r.title : r.body} style={styles.reading} />
      <HoverMeta always={last || (r.undo !== null && r.undone_at === null)}>
        <View style={styles.meta}>
          <Text style={[styles.metaText, font.mono]}>{clock(r.at)}</Text>
          <Text style={styles.metaText}>{sourceName(r.source)}</Text>
          <UndoButton record={r} label={t('撤销')} />
          {/* 只有维护会话的消息有讨论可看 */}
          {feedbackId === null ? null : (
            <Text style={styles.link} onPress={() => router.push({ pathname: '/feedback/[id]', params: { id: feedbackId } })}>
              {t('看讨论')}
            </Text>
          )}
        </View>
      </HoverMeta>
    </View>
  )
}

// 系统短消息（tier=log，如"已转给 Mac""已记成事项"）：13 tx2 一行 + 14 图标，收起看 title，点开看 body 和"打开事项 ›"
function LogLine({ record: r, last }: { record: HubRecord; last: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const more = r.body !== '' && r.body !== r.title
  const itemId = r.item_id
  const Icon = r.title.includes('Mac') ? Laptop : Check
  return (
    <View {...hoverGroup}>
      <Pressable style={styles.log} onPress={() => setOpen(!open)} disabled={!more && itemId === null}>
        <Icon size={14} color={colors.tx2} strokeWidth={1.8} />
        <Text style={styles.logText}>{r.title}</Text>
        {more || itemId !== null ? (
          <View style={open && styles.chevOpen}>
            <ChevronRight size={14} color={colors.tx3} strokeWidth={1.8} />
          </View>
        ) : null}
      </Pressable>
      {open && more ? <Text style={styles.logBody}>{r.body}</Text> : null}
      {open && itemId !== null ? (
        <Text style={[styles.logBody, styles.linkBody]} onPress={() => router.push({ pathname: '/items/[id]', params: { id: itemId } })}>
          {t('打开事项 ›')}
        </Text>
      ) : null}
      <HoverMeta always={last || (r.undo !== null && r.undone_at === null)}>
        <View style={styles.meta}>
          <Text style={[styles.metaText, font.mono]}>{clock(r.at)}</Text>
          <Text style={styles.metaText}>{sourceName(r.source)}</Text>
          <UndoButton record={r} label={t('撤销')} />
        </View>
      </HoverMeta>
    </View>
  )
}

// 我的消息：右对齐，fill 底、圆角 12、10×14、15/22，最宽 80%；图片在气泡上方；时间悬停才出现。
// 等回复时下面一行"回复中…"，失败时写原因；转给 Mac 时 agent 已写了"已转给 Mac"，这里不再重复
function Mine({ record: r, job }: { record: HubRecord; job: Job | undefined }) {
  const waiting = job !== undefined && job.runner !== 'mac' && (job.status === 'queued' || job.status === 'running')
  const failed = job !== undefined && job.status === 'failed'
  return (
    <View style={styles.me} {...hoverGroup}>
      <Thumbs record={r} />
      {r.body === '' ? null : <Text style={styles.bubble}>{r.body}</Text>}
      <HoverMeta always={false}>
        <Text style={[styles.metaText, font.mono]}>{clock(r.at)}</Text>
      </HoverMeta>
      {waiting ? <Text style={styles.metaText}>{t('回复中…')}</Text> : null}
      {failed && job !== undefined ? <Text style={[styles.metaText, { color: colors.bad }]}>{t('回复失败：{error}', { error: String(job.error) })}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  scrollWrap: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 24, paddingBottom: 16, paddingHorizontal: dt.space.pageX },
  column: { width: '100%', maxWidth: dt.width.chat, alignSelf: 'center' },
  older: { alignItems: 'center', marginBottom: 16 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24 },
  foot: { paddingHorizontal: dt.space.pageX, paddingBottom: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: dt.space.pageX, paddingBottom: 96 },
  // 问候（拍板 2）：36/44 Songti SC，只用在今天页和这里
  display: { fontFamily: '"Songti SC", STSong, serif', fontWeight: '400', fontSize: 36, lineHeight: 44, color: colors.tx },
  ai: { maxWidth: dt.width.aiText },
  label: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx2, marginBottom: 4 },
  reading: { ...font.regular, fontSize: size.title, lineHeight: dt.line.reading, color: colors.tx, userSelect: 'text' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 16, marginTop: 8 },
  metaText: { ...font.regular, fontSize: size.small, lineHeight: dt.line.small, color: colors.tx3 },
  link: { ...font.regular, fontSize: size.small, color: colors.brand },
  log: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  logText: { ...font.regular, fontSize: size.secondary, lineHeight: dt.line.secondary, color: colors.tx2 },
  chevOpen: { transform: [{ rotate: '90deg' }] },
  logBody: {
    ...font.regular,
    fontSize: size.secondary,
    lineHeight: dt.line.secondary,
    color: colors.tx2,
    marginTop: 4,
    marginLeft: 20,
    userSelect: 'text',
  },
  linkBody: { color: colors.brand },
  me: { alignSelf: 'flex-end', maxWidth: '80%', alignItems: 'flex-end', gap: 6 },
  bubble: {
    ...font.regular,
    fontSize: size.body,
    lineHeight: dt.line.body,
    color: colors.tx,
    backgroundColor: overlay.fill,
    borderRadius: dt.radius.bubble,
    paddingVertical: 10,
    paddingHorizontal: 14,
    userSelect: 'text',
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 8,
    backgroundColor: overlay.fill,
    maxWidth: 360,
  },
  chipText: { ...font.regular, fontSize: size.small, color: colors.tx2, flexShrink: 1 },
})
