import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { X, type LucideIcon } from 'lucide-react-native'
import { hubRequest } from '../api/client'
import type { ChatPage, HubRecord, SourcesList } from '../api/types'
import { useConfig } from '../config/context'
import { t } from '../i18n'
import { useErrorToast } from '../toast'
import { colors, desktop, font, size } from '../theme'
import { fadeTop } from '../web-data'
import { useHub } from '../use-hub'
import { useWide } from '../wide'
import { BottomInset } from './BottomInset'
import { ChatThread, Composer, mergeChat, useChatJobs, useReplyPolling } from './Chat'
import { StaleBanner } from './Screen'
import { Btn, Empty } from './ui'

const PAGE = 30

// 对话头部右侧的 server 状态
export function useServerStatus(): { text: string; bad: boolean } {
  const sources = useHub<SourcesList>('/sources')
  const server = sources.data === null ? undefined : sources.data.sources.find((s) => s.name === 'server-agent')
  if (server === undefined) return { text: t('服务器 agent 未登记'), bad: false }
  return { text: server.alive ? t('服务器在线') : t('服务器失联'), bad: !server.alive }
}

export type ChatAbout = { itemId: string | null; projectId: string | null; cardId: string | null }

// 对话数据：最新一页 + 往前翻的 + 本次刚发出的，回复任务，有消息在等回复时轮询。手机对话页和电脑对话整页共用
export function useChatData() {
  const { config } = useConfig()
  const showError = useErrorToast()
  const view = useHub<ChatPage>(`/chat?limit=${PAGE}`)
  const { byRecord, refresh: refreshJobs } = useChatJobs()
  const [older, setOlder] = useState<HubRecord[]>([])
  const [sent, setSent] = useState<HubRecord[]>([])
  const [exhausted, setExhausted] = useState(false)

  const latest = view.data === null ? [] : view.data.records
  const records = mergeChat([...latest, ...older], sent)

  const refreshAll = useCallback(() => {
    view.refresh()
    refreshJobs()
  }, [view.refresh, refreshJobs])
  useReplyPolling(records, byRecord, refreshAll)

  // 往前翻一页；onLoaded 在追加前调用（手机页用它暂停自动滚到底）
  const loadOlder = async (onLoaded: () => void) => {
    if (config.hub === null) throw new Error('没有 hub 配置')
    const oldest = records[0]
    try {
      const page = await hubRequest<ChatPage>(config.hub, 'GET', `/chat?limit=${PAGE}&before=${encodeURIComponent(oldest.id)}`)
      onLoaded()
      setOlder((prev) => [...prev, ...page.records])
      if (page.records.length < PAGE) setExhausted(true)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('加载失败'), err)
    }
  }
  const canLoadOlder = view.data !== null && view.data.records.length === PAGE && !exhausted
  const addSent = (r: HubRecord) => {
    setSent((prev) => [...prev, r])
    refreshAll()
  }
  return { view, records, byRecord, loadOlder, canLoadOlder, addSent }
}

// 对话主体（手机、浏览器窄屏）：消息列表 + 上下文条 + 输入框。电脑宽屏见 src/desktop/ChatWide.tsx
export function ChatBody({ about, contextBar }: { about: ChatAbout; contextBar: ReactNode }) {
  const wide = useWide()
  const { view, records, byRecord, loadOlder, canLoadOlder, addSent } = useChatData()
  const scroll = useRef<ScrollView>(null)
  const atBottom = useRef(true)

  return (
    <>
      <View style={styles.scrollWrap}>
        <ScrollView
          ref={scroll}
          style={styles.scroll}
          contentContainerStyle={[styles.content, wide && styles.column]}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
            atBottom.current = contentOffset.y + layoutMeasurement.height > contentSize.height - 60
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottom.current) scroll.current?.scrollToEnd({ animated: false })
          }}
        >
          <StaleBanner view={view} />
          {canLoadOlder ? (
            <View style={styles.older}>
              <Btn label={t('更早的')} onPress={() => loadOlder(() => (atBottom.current = false))} />
            </View>
          ) : null}
          {view.data !== null && records.length === 0 ? <Empty text={t('还没有对话。问点什么吧，比如“今天该先做什么？”')} /> : null}
          <ChatThread records={records} byRecord={byRecord} />
        </ScrollView>
        {/* 电脑：输入卡上方 24px 渐变遮罩，消息淡出而不是被硬切 */}
        {desktop ? <View style={styles.fade} {...fadeTop} /> : null}
      </View>
      <View style={wide && styles.column}>{contextBar}</View>
      <BottomInset>
        <View style={[wide && styles.column, desktop && styles.composerGap]}>
          <Composer
            // 不选项目、不分"反馈"：Claude 自己判断是问项目还是给 mojito 提意见（design.md 8.3）
            target={{
              kind: 'chat',
              ...about,
              onSent: (r) => {
                atBottom.current = true
                addSent(r)
              },
            }}
            placeholder={t('发消息…')}
            chips={null}
          />
        </View>
      </BottomInset>
    </>
  )
}

// 上下文条：对话在说哪个东西，可以去掉
export function ContextBar({ icon: Icon, text, onClear }: { icon: LucideIcon; text: string; onClear: () => void }) {
  return (
    <View style={styles.ctx}>
      <Icon size={13} color={colors.brand} />
      <Text style={styles.ctxText} numberOfLines={1}>
        {text}
      </Text>
      <Pressable accessibilityLabel={t('不带这个上下文')} hitSlop={8} onPress={onClear}>
        <X size={14} color={colors.tx2} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // 顶部留白：第一条消息不贴着顶栏（design.md 8.7）；电脑 24，最上面的消息在顶栏底边处被干净地裁掉
  content: { paddingHorizontal: 16, paddingTop: desktop ? 24 : 16, paddingBottom: 16, gap: 10 },
  scrollWrap: { flex: 1 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24 },
  older: { flexDirection: 'row', justifyContent: 'center' },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  composerGap: { paddingHorizontal: 16, paddingBottom: 16 },
  ctx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
  },
  ctxText: { ...font.regular, fontSize: size.secondary, color: colors.tx, flex: 1 },
})
