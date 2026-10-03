import { useState } from 'react'
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Eye, Newspaper } from 'lucide-react-native'
import type { Card } from '../src/api/types'
import { ChatBody, ContextBar, useServerStatus, type ChatAbout } from '../src/components/ChatPane'
import { TopBar } from '../src/components/Screen'
import { colors, desktop, font, size } from '../src/theme'
import { ChatWide } from '../src/desktop/ChatWide'
import { humanize } from '../src/errors'
import { t } from '../src/i18n'
import { useHub } from '../src/use-hub'
import { useViewTracking } from '../src/usage'
import { useWide, type Subject } from '../src/wide'
export { PageError as ErrorBoundary } from '../src/components/PageError'

type Params = { card_id?: string; kind?: Subject['kind']; id?: string; title?: string }

// 对话：像发短信，发出即可离开，回复到了推送。早上简报、晚上提问也在这里。
// 手机从卡片"问问这个"进来带 card_id；宽屏（整页对话，design.md 8.4）从别的页 ⌘J / "对话"进来带正在看的 kind + id + title。
// 发出的消息都关于它，直到手动去掉
export default function ChatScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const wide = useWide()
  const status = useServerStatus()
  const params = useLocalSearchParams<Params>()
  const [subject, setSubject] = useState<Subject | null>(subjectOf(params))
  useViewTracking('chat')

  const about: ChatAbout = {
    itemId: subject !== null && subject.kind === 'item' ? subject.id : null,
    projectId: subject !== null && subject.kind === 'project' ? subject.id : null,
    cardId: subject !== null && subject.kind === 'card' ? subject.id : null,
  }
  const contextBar =
    subject === null ? null : params.card_id !== undefined ? (
      <CardContext cardId={subject.id} onClear={() => setSubject(null)} />
    ) : (
      <ContextBar icon={Eye} text={t('正在看：{title}', { title: subject.title })} onClear={() => setSubject(null)} />
    )

  // 电脑宽屏：对话整页（src/desktop/ChatWide.tsx），上下文是输入卡里的芯片
  if (wide && desktop) {
    return (
      <ChatWide
        about={about}
        context={subject === null ? null : params.card_id !== undefined ? <CardTitle cardId={subject.id} /> : t('正在看：{title}', { title: subject.title })}
        onClearContext={() => setSubject(null)}
      />
    )
  }
  return (
    // 输入框避让键盘和底部导航条
    <KeyboardAvoidingView style={[styles.page, !wide && { paddingTop: insets.top + 6 }]} behavior="padding">
      {wide ? (
        <TopBar head={{ kind: 'title', title: t('对话') }} sub={status.text} tools={null} syncing={false} />
      ) : (
        <View style={styles.head}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.headSide}>
            <ChevronLeft size={18} color={colors.tx2} />
          </Pressable>
          <Text style={styles.title}>{t('对话')}</Text>
          <Text style={[styles.headSide, styles.status, status.bad && { color: colors.bad }]}>{status.text}</Text>
        </View>
      )}
      <View style={styles.body}>
        <ChatBody about={about} contextBar={contextBar} />
      </View>
    </KeyboardAvoidingView>
  )
}

function subjectOf(p: Params): Subject | null {
  if (p.card_id !== undefined) return { kind: 'card', id: p.card_id, title: '' }
  if (p.kind === undefined) return null
  if (p.id === undefined || p.title === undefined) throw new Error(`对话页参数不全：${JSON.stringify(p)}`)
  return { kind: p.kind, id: p.id, title: p.title }
}

// 电脑对话整页的芯片文字：从信息流卡片"问问"进来时写卡片标题
function CardTitle({ cardId }: { cardId: string }) {
  const card = useHub<Card>(`/cards/${encodeURIComponent(cardId)}`)
  const title = card.data === null ? (card.error === null ? t('读取卡片…') : humanize(card.error).message) : card.data.title
  return <>{t('关于：{title}', { title })}</>
}

// 从卡片"问问这个"进来：显示在问哪张卡片，可以去掉
function CardContext({ cardId, onClear }: { cardId: string; onClear: () => void }) {
  const card = useHub<Card>(`/cards/${encodeURIComponent(cardId)}`)
  const title = card.data === null ? (card.error === null ? t('读取卡片…') : humanize(card.error).message) : card.data.title
  return <ContextBar icon={Newspaper} text={t('关于：{title}', { title })} onClear={onClear} />
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headSide: { width: 110 },
  title: { ...font.bold, fontSize: size.title, color: colors.tx },
  status: { ...font.regular, fontSize: size.small, color: colors.tx2, textAlign: 'right' },
  body: { flex: 1 },
})
