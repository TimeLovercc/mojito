import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowUp, ChevronRight } from 'lucide-react-native'
import { actions, hubRequest } from '../../src/api/client'
import type { HubRecord, ItemDetail, ProjectsList, RecordsPage } from '../../src/api/types'
import { RichText } from '../../src/components/RichText'
import { Screen } from '../../src/components/Screen'
import { UndoButton } from '../../src/components/Undo'
import { Thumbs } from '../../src/components/Chat'
import { useImageAttach } from '../../src/components/ImageAttach'
import { useDesktopInput } from '../../src/input'
import { useWide } from '../../src/wide'
import { addDays, clock, longDate, todayYmd, weekdayOf, when, ymdOf } from '../../src/time'
import { composerD, sendArrow } from '../../src/components/ComposerStyle'
import { useDraft } from '../../src/draft'
import { Btn, Card, Empty, Rows } from '../../src/components/ui'
import { useConfig } from '../../src/config/context'
import { humanize } from '../../src/errors'
import { useRefresh } from '../../src/refresh'
import { useErrorToast, useToast } from '../../src/toast'
import { colors, desktop, font, radii, size } from '../../src/theme'
import { trackAction, useViewTracking } from '../../src/usage'
import { useHub } from '../../src/use-hub'
import { hoverRow } from '../../src/web-data'
import { t } from '../../src/i18n'

const PAGE = 30

// hub 部署带 kind/author 过滤的 GET /records 之前会忽略这些参数、返回全部记录，所以前端也按同样条件过滤一遍
const isMyNote = (r: HubRecord) => r.kind === 'note' && r.author === 'me'

// 笔记（design.md 8.3）：顶部一个输入框，写完就发，全部交给 Claude 整理；下面一条时间线，点一条原地展开
export default function NotesScreen() {
  const base = `/records?kind=note&author=me&limit=${PAGE}`
  const view = useHub<RecordsPage>(base)
  // 从小组件"笔记"进来（mojito://note → /notes?focus=1）或按 ⌘N（focus=时间戳）时输入框聚焦
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  const projects = useHub<ProjectsList>('/projects')
  const { config } = useConfig()
  const showError = useErrorToast()
  const [older, setOlder] = useState<HubRecord[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const wide = useWide()
  useViewTracking('notes')

  const page = view.data
  useEffect(() => {
    setOlder([])
    setExhausted(page !== null && page.records.length < PAGE)
  }, [page])

  const projectTitle = (id: string | null) => {
    if (id === null || projects.data === null) return null
    const p = projects.data.projects.find((x) => x.id === id)
    return p === undefined ? null : p.title
  }

  const loadOlder = async (all: HubRecord[]) => {
    if (config.hub === null) throw new Error('没有 hub 配置')
    const last = all[all.length - 1]
    try {
      const next = await hubRequest<RecordsPage>(config.hub, 'GET', `${base}&before=${encodeURIComponent(last.id)}`)
      setOlder((prev) => [...prev, ...next.records])
      if (next.records.length < PAGE) setExhausted(true)
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('加载失败'), err)
    }
  }

  return (
    <Screen
      view={view}
      head={{ kind: 'title', title: t('笔记') }}
      top={<QuickNote onSent={view.refresh} focus={focus === undefined ? null : focus} />}
    >
      {({ records }) => {
        const all = [...records, ...older]
        const notes = all.filter(isMyNote)
        return (
          <View style={{ gap: 10 }}>
            {notes.length === 0 ? (
              <Empty text={t('还没有笔记，上面写一句试试')} />
            ) : wide && desktop ? (
              <NotesByDay
                notes={notes}
                projectTitle={projectTitle}
                open={open}
                onToggle={(id) => setOpen(open === id ? null : id)}
                onHidden={view.refresh}
              />
            ) : (
              <Card>
                <Rows>
                  {notes.map((r) => (
                    <NoteRow
                      key={r.id}
                      note={r}
                      project={projectTitle(r.project_id)}
                      open={open === r.id}
                      onToggle={() => setOpen(open === r.id ? null : r.id)}
                      onHidden={view.refresh}
                    />
                  ))}
                </Rows>
              </Card>
            )}
            {exhausted ? (
              <Text style={styles.end}>{t('没有更早的了')}</Text>
            ) : (
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                <Btn label={t('再往前')} onPress={() => loadOlder(all)} />
              </View>
            )}
          </View>
        )
      }}
    </Screen>
  )
}

// 电脑（docs/desktop-v2.md 逐页方案 5）：按天分组，组头 13/500 tx2；每条不套卡片——44 宽时间列、正文 15/24 可选中
// （收起最多 4 行）、项目名 12 tx3、缩略图；悬停叠 hover，点开原地展开和手机一样的"打开事项 / 撤销整理 / 删除"
function NotesByDay({
  notes,
  projectTitle,
  open,
  onToggle,
  onHidden,
}: {
  notes: HubRecord[]
  projectTitle: (id: string | null) => string | null
  open: string | null
  onToggle: (id: string) => void
  onHidden: () => Promise<void>
}) {
  const today = todayYmd()
  const label = (ymd: string) => (ymd === today ? t('今天') : ymd === addDays(today, -1) ? t('昨天') : `${longDate(ymd)} ${weekdayOf(ymd)}`)
  return (
    <View>
      {notes.map((r, i) => {
        const day = ymdOf(new Date(r.at))
        const newDay = i === 0 || ymdOf(new Date(notes[i - 1].at)) !== day
        const project = projectTitle(r.project_id)
        const text = noteText(r)
        return (
          <View key={r.id}>
            {newDay ? <Text style={[styles.dayHead, i === 0 && { marginTop: 0 }]}>{label(day)}</Text> : null}
            <Pressable style={styles.rowD} onPress={() => onToggle(r.id)} {...hoverRow}>
              <Text style={styles.timeD}>{clock(r.at)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                {r.title === '[图片]' && r.body === '' ? null : (
                  <RichText text={text} style={styles.textD} enums={false} numberOfLines={open === r.id ? undefined : 4} />
                )}
                <Thumbs record={r} />
                {project === null ? null : <Text style={styles.projectD}>{project}</Text>}
                {open === r.id ? <NoteDetail note={r} onHidden={onHidden} /> : null}
              </View>
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

// 笔记正文：现在 body 是整段原文（第一行同时当 title）；09-29 之前的笔记 body 只存第一行以后的部分，拼回 title
function noteText(note: HubRecord): string {
  if (note.body === '') return note.title
  return note.body.startsWith(note.title) ? note.body : `${note.title}\n${note.body}`
}

function NoteRow({
  note,
  project,
  open,
  onToggle,
  onHidden,
}: {
  note: HubRecord
  project: string | null
  open: boolean
  onToggle: () => void
  onHidden: () => Promise<void>
}) {
  const text = noteText(note)
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]} onPress={onToggle} {...hoverRow}>
      {note.title === '[图片]' && note.body === '' ? null : (
        <RichText text={text} style={styles.text} enums={false} numberOfLines={open ? undefined : 4} />
      )}
      <Thumbs record={note} />
      <Text style={styles.meta}>
        <Text style={font.mono}>{when(note.at)}</Text>
        {project === null ? '' : ` · ${project}`}
      </Text>
      {open ? <NoteDetail note={note} onHidden={onHidden} /> : null}
    </Pressable>
  )
}

// 展开后：变成了哪个事项（可点过去）、撤销整理、删除
function NoteDetail({ note, onHidden }: { note: HubRecord; onHidden: () => Promise<void> }) {
  return (
    <View style={styles.detail}>
      {note.item_id === null ? <Text style={styles.meta}>{t('没有变成事项')}</Text> : <BecameItem itemId={note.item_id} />}
      <HideButton note={note} onHidden={onHidden} />
    </View>
  )
}

// 笔记挂到的事项；如果是 Claude 由这条笔记新建的，事项记录里有一条带 undo.type=item_create 的，给"撤销整理"
function BecameItem({ itemId }: { itemId: string }) {
  const router = useRouter()
  const view = useHub<ItemDetail>(`/items/${encodeURIComponent(itemId)}`)
  if (view.data === null) {
    return <Text style={styles.meta}>{view.error === null ? t('读取事项…') : t('读不到事项：{message}', { message: humanize(view.error).message })}</Text>
  }
  const { item, records } = view.data
  const created = records.find((r) => r.undo !== null && r.undo.type === 'item_create' && r.undo.item_id === itemId)
  return (
    <View style={styles.acts}>
      <Pressable style={styles.link} hitSlop={6} onPress={() => router.push({ pathname: '/items/[id]', params: { id: itemId } })}>
        <Text style={styles.linkText} numberOfLines={1}>
          {t('变成了事项：{title}', { title: item.title })}
        </Text>
        <ChevronRight size={14} color={colors.brand} />
      </Pressable>
      {created === undefined ? null : <UndoButton record={created} label={t('撤销整理')} />}
    </View>
  )
}

function HideButton({ note, onHidden }: { note: HubRecord; onHidden: () => Promise<void> }) {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  const hide = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.hideRecord(config.hub, note.id)
      toast(t('已删除'), false)
      await onHidden()
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没删掉'), err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Pressable onPress={hide} disabled={busy} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
      <Text style={[styles.hide, busy && { opacity: 0.5 }]}>{t('删除')}</Text>
    </Pressable>
  )
}

// 一个输入框：第一行做标题，其余做正文；一律交给 Claude 整理（needs_processing 固定 true，不选项目）
// focus：路由参数 focus 的值，每次变化（小组件、⌘N、侧边栏"笔记"按钮）都把光标放进输入框
function QuickNote({ onSent, focus }: { onSent: () => Promise<void>; focus: string | null }) {
  const input = useRef<TextInput>(null)
  useEffect(() => {
    if (focus !== null) input.current?.focus()
  }, [focus])
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [text, setText] = useDraft('note')
  const [busy, setBusy] = useState(false)
  // 笔记可以带图片，整理时 Claude 看图（design.md 8.6）
  const attach = useImageAttach(busy)
  const send = async () => {
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    const hub = config.hub
    const lines = text.trim().split('\n')
    setBusy(true)
    try {
      const ids = await attach.upload(hub)
      const title = lines[0].trim()
      await actions.addRecord(hub, {
        title: title === '' ? '[图片]' : title,
        body: text.trim(),
        item_id: null,
        project_id: null,
        needs_processing: true,
        attachment_ids: ids,
      })
      trackAction('note', { needs_processing: true, images: String(ids.length) })
      // 电脑上不弹提示，笔记直接出现在下面的时间线里
      if (!desktop) toast(t('记好了，Claude 会整理'), false)
      setText('')
      attach.clear()
      await onSent()
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没记上'), err)
    } finally {
      setBusy(false)
    }
  }
  const canSend = !busy && (text.trim() !== '' || attach.count > 0)
  const desk = useDesktopInput(text, () => (canSend ? send() : undefined), input)
  return (
    <View>
      {desktop ? null : attach.pending}
      {attach.chooser}
      {/* 电脑：两层输入卡，待发缩略图在卡片顶行（docs/desktop-v2.md 笔记） */}
      <View style={desktop ? composerD.card : styles.quick}>
        {desktop && attach.count > 0 ? <View style={composerD.chips}>{attach.pending}</View> : null}
        <View style={desktop ? composerD.row : styles.quickRow}>
          {attach.button}
          <TextInput
            ref={input}
            style={[styles.input, desk.style]}
            onKeyPress={desk.onKeyPress}
            numberOfLines={desk.numberOfLines}
            placeholder={t('写笔记…要办的事会自动变成事项')}
            placeholderTextColor={desktop ? colors.tx3 : colors.tx2}
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
          />
          <Pressable
            accessibilityLabel={t('记下')}
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
    </View>
  )
}

const styles = StyleSheet.create({
  // 手机：外框 + 一行（quickRow）
  quick: {
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quickRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { ...font.regular, flex: 1, minHeight: 40, maxHeight: 160, color: colors.tx, fontSize: size.body, paddingVertical: 8 },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  row: { paddingVertical: 10, paddingHorizontal: 13, gap: 4 },
  text: { ...font.regular, fontSize: size.body, color: colors.tx, ...(desktop ? { userSelect: 'text' as const } : {}) },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  detail: { gap: 8, marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  linkText: { ...font.regular, fontSize: size.secondary, color: colors.brand, flexShrink: 1 },
  hide: { ...font.regular, fontSize: size.secondary, color: colors.bad },
  dayHead: { ...font.medium, fontSize: size.secondary, color: colors.tx2, marginTop: 20, marginBottom: 6, paddingHorizontal: 8 },
  rowD: { flexDirection: 'row', gap: 0, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  timeD: { ...font.mono, width: 44, fontSize: size.small, lineHeight: 24, color: colors.tx3 },
  textD: { ...font.regular, fontSize: size.body, lineHeight: 24, color: colors.tx, userSelect: 'text' },
  projectD: { ...font.regular, fontSize: size.small, color: colors.tx3, marginTop: 2 },
  end: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'center', marginTop: 8 },
})
