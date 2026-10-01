import { useCallback, useState } from 'react'
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import type { ChatPage, GoalsList, HubRecord, ItemDetail, ProjectsList } from '../../src/api/types'
import { ChatThread, Composer, mergeChat, useChatJobs, useReplyPolling } from '../../src/components/Chat'
import { ItemDecision, ItemLifecycle } from '../../src/components/Decision'
import { ProgressBar } from '../../src/components/ProgressBar'
import { RecordLine } from '../../src/components/RecordLine'
import { Screen } from '../../src/components/Screen'
import { Card, Empty, Section } from '../../src/components/ui'
import { category, itemStatus, owner, sourceName } from '../../src/labels'
import { when } from '../../src/time'
import { colors, desktop, font, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useScreenIds, useViewTracking } from '../../src/usage'
import { useChatSubject, useWide } from '../../src/wide'
import { ItemToolsD } from '../../src/desktop/ItemTools'
import { t } from '../../src/i18n'

const toneColor = { g: colors.ok, a: colors.warn, r: colors.bad, n: colors.tx2, b: colors.brand } as const

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const view = useHub<ItemDetail>(`/items/${encodeURIComponent(id)}`)
  const goals = useHub<GoalsList>('/goals')
  const projects = useHub<ProjectsList>('/projects')
  const wide = useWide()
  useViewTracking('item_detail')
  useScreenIds(id, view.data === null ? null : view.data.item.project_id)
  useChatSubject(view.data === null ? null : { kind: 'item', id, title: view.data.item.title })
  // 这件事下的对话：底部输入框发的消息带 item_id，Claude 判断是记录还是提问，回复时带上事项上下文
  const chat = useHub<ChatPage>(`/chat?item_id=${encodeURIComponent(id)}&limit=30`)
  const { byRecord, refresh: refreshJobs } = useChatJobs()
  const [sent, setSent] = useState<HubRecord[]>([])
  const thread = mergeChat(chat.data === null ? [] : chat.data.records, sent)
  const refreshAll = useCallback(() => {
    chat.refresh()
    refreshJobs()
    view.refresh()
  }, [chat.refresh, refreshJobs, view.refresh])
  useReplyPolling(thread, byRecord, refreshAll)
  // 电脑宽屏（docs/desktop-v2.md 逐页方案 3）：顶栏"‹ 项目名"，右侧"完成""⋯"；等你拍板的事项仍在正文里同意 / 不要
  const deskBar = wide && desktop
  const item = view.data === null ? null : view.data.item
  const project =
    item === null || item.project_id === null || projects.data === null
      ? undefined
      : projects.data.projects.find((p) => p.id === item.project_id)
  return (
    <Screen
      view={view}
      head={{ kind: 'back', label: deskBar && project !== undefined ? project.title : t('事项') }}
      tools={deskBar && item !== null && item.status !== 'waiting_you' ? <ItemToolsD item={item} /> : null}
      bottom={
        <Composer
          target={{
            kind: 'chat',
            itemId: id,
            projectId: view.data === null ? null : view.data.item.project_id,
            cardId: null,
            onSent: (r) => {
              setSent((prev) => [...prev, r])
              refreshAll()
            },
          }}
          placeholder={t('写笔记或问问这件事…')}
          chips={null}
        />
      }
    >
      {({ item, records }) => {
        const goal = item.goal_id === null || goals.data === null ? undefined : goals.data.goals.find((g) => g.id === item.goal_id)
        const status = itemStatus[item.status]
        return (
          <>
            <View style={styles.dh}>
              <Text style={styles.h2}>{item.title}</Text>
              <View style={styles.chips}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>
                    {goal === undefined ? category[item.category].label : `${category[item.category].label} · ${goal.title}`}
                  </Text>
                </View>
                <View style={styles.chip}>
                  <Text style={[styles.chipText, { color: toneColor[status.tone] }]}>{status.label}</Text>
                </View>
                {item.forgotten ? (
                  <View style={styles.chip}>
                    <Text style={[styles.chipText, { color: colors.bad }]}>{t('被忘了')}</Text>
                  </View>
                ) : null}
              </View>
              {item.status === 'waiting_you' ? <ItemDecision item={item} /> : deskBar ? null : <ItemLifecycle item={item} />}
            </View>

            <Card style={styles.kv}>
              <Field label={t('下一步')} value={item.next_step} />
              <Field label={t('什么时候')} value={item.next_at === null ? t('没有时间') : when(item.next_at)} />
              <Field label={t('谁做')} value={owner[item.owner]} />
              <Field label={t('算完成')} value={item.done_definition} strong />
              {item.progress === null ? null : (
                <View style={styles.field}>
                  <Text style={styles.dt}>{t('进度')}</Text>
                  <View style={{ flex: 1 }}>
                    <ProgressBar progress={item.progress} color={colors.brand} />
                  </View>
                </View>
              )}
              <Text style={styles.updated}>
                {t('{time} · 由 {who} 更新', { time: when(item.updated_at), who: sourceName(item.updated_by) })}
              </Text>
            </Card>

            {thread.length === 0 ? null : (
              <Section title={t('对话')} right={String(thread.length)}>
                <ChatThread records={thread} byRecord={byRecord} />
              </Section>
            )}

            <RecordsFold records={records.filter((r) => r.kind !== 'chat')} />
          </>
        )
      }}
    </Screen>
  )
}

// 记录默认折叠，点标题展开
function RecordsFold({ records }: { records: HubRecord[] }) {
  const [open, setOpen] = useState(false)
  if (records.length === 0) return <Empty text={t('还没有记录')} />
  return (
    <View>
      <Pressable style={styles.fold} onPress={() => setOpen(!open)} hitSlop={6}>
        <Text style={styles.foldText}>{t('记录 {n} 条', { n: records.length })}</Text>
        {open ? <ChevronUp size={16} color={colors.tx2} /> : <ChevronDown size={16} color={colors.tx2} />}
      </Pressable>
      {open ? records.map((r) => <RecordLine key={r.id} record={r} linkItem={false} showDate={when} />) : null}
    </View>
  )
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.dt}>{label}</Text>
      <Text style={[styles.dd, strong && font.semibold]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  dh: { gap: 6 },
  h2: { ...font.bold, fontSize: size.page, color: colors.tx, letterSpacing: desktop ? 0 : -0.4, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.raised,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  kv: { paddingVertical: 11, paddingHorizontal: 13, gap: 7 },
  field: { flexDirection: 'row', gap: 10 },
  // 标签最长四个字，宽度随字号设置和系统字体大小走
  dt: { ...font.regular, width: size.small * 4 * PixelRatio.getFontScale() + 6, fontSize: size.small, color: colors.tx2, paddingTop: 1 },
  dd: { ...font.regular, flex: 1, fontSize: size.secondary, color: colors.tx },
  fold: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  foldText: { ...font.semibold, fontSize: size.secondary, color: colors.tx2 },
  updated: { ...font.regular, fontSize: size.small, color: colors.tx2, marginTop: 2 },
})
