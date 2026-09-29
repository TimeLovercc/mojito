import type { ReactNode } from 'react'
import { Linking, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { ENUM_NAMES, FIELD_NAMES } from '../labels'
import { when } from '../time'
import { colors, desktop, font, overlay } from '../theme'
import { t } from '../i18n'

// hub / worker 写的文字里会带内部值，这里统一改成人能读的：
// - ISO 时间 → 本地短格式
// - 记录 id（record:r-…、"来源笔记 r-…"）→ 可点的"来源笔记"
// - Markdown 链接 [文字](网址) → 显示文字，可点（每日邮件卡的"打开"）；**粗体** → 粗体；`代码` → 等宽浅底
// - 网址 → 显示域名，可点
// - enums=true（系统写的文字）时，字段名和枚举值（status、waiting_you…）→ 中文
const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})`
const RECORD = String.raw`(?:来源笔记\s*)?(?:record:)?\b(r-[0-9a-f]{8,})\b`
const URL_RE = String.raw`https?://[^\s)）\]」]+`
const MD_LINK = String.raw`\[([^\]\n]+)\]\((https?://[^\s)]+)\)`
const BOLD = String.raw`\*\*([^*\n]+)\*\*`
const CODE = String.raw`\`([^\`\n]+)\``
const WORDS = [...Object.keys(FIELD_NAMES), ...Object.keys(ENUM_NAMES)].sort((a, b) => b.length - a.length)
const ENUM = String.raw`\b(?:${WORDS.join('|')})\b`

function domain(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0]
}

export function RichText({
  text,
  style,
  enums,
  numberOfLines,
}: {
  text: string
  style: StyleProp<TextStyle>
  enums: boolean
  numberOfLines?: number
}) {
  const pattern = new RegExp(`${CODE}|${BOLD}|${MD_LINK}|(${ISO})|${RECORD}|(${URL_RE})${enums ? `|(${ENUM})` : ''}`, 'g')
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(pattern)) {
    const at = m.index
    if (at === undefined) throw new Error('matchAll 没给出位置')
    if (at > last) parts.push(text.slice(last, at))
    const [whole, codeText, boldText, mdText, mdUrl, iso, recordId, url, word] = m
    if (codeText !== undefined)
      parts.push(
        <Text key={at} style={code}>
          {codeText}
        </Text>,
      )
    else if (boldText !== undefined)
      parts.push(
        <Text key={at} style={bold}>
          {boldText}
        </Text>,
      )
    else if (mdText !== undefined)
      parts.push(
        <Text key={at} style={link} onPress={() => Linking.openURL(mdUrl)}>
          {mdText}
        </Text>,
      )
    else if (iso !== undefined) parts.push(when(iso))
    else if (recordId !== undefined) parts.push(<RecordLink key={at} id={recordId} />)
    else if (url !== undefined)
      parts.push(
        <Text key={at} style={link} onPress={() => Linking.openURL(url)}>
          {domain(url)}
        </Text>,
      )
    else if (word !== undefined) parts.push(word in FIELD_NAMES ? FIELD_NAMES[word] : ENUM_NAMES[word])
    else throw new Error(`RichText 匹配到未处理的片段：${whole}`)
    last = at + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts}
    </Text>
  )
}

function RecordLink({ id }: { id: string }) {
  const router = useRouter()
  return (
    <Text style={link} onPress={() => router.push({ pathname: '/records/[id]', params: { id } })}>
      {t('来源笔记')}
    </Text>
  )
}

// Record.evidence：inferred → 推断；record:<id> → 来源笔记；网址 → 域名；其他按正文处理
export function Evidence({ evidence, style }: { evidence: string; style: StyleProp<TextStyle> }) {
  if (evidence === 'inferred') return <Text style={style}>{t('推断')}</Text>
  return <RichText text={evidence} style={style} enums={false} />
}

const link: TextStyle = { color: colors.brand, textDecorationLine: 'underline' }
const bold: TextStyle = { fontWeight: '600' }
const code: TextStyle = { ...font.mono, backgroundColor: overlay.fill, borderRadius: 4, paddingHorizontal: 3 }

// Markdown（design.md 8.7、docs/desktop-v2.md #3）：行内粗体、代码、链接照 RichText；按行识别列表（- / * / · / 1.）、
// 引用（>）、标题（#）、缩进层级（每 2 个空格一级）；单个换行就是换行（每日邮件一行一封），空行分段。
// 对话回复、反馈讨论、卡片详情用它；列表里的摘要用 plainText
export function Markdown({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const blocks: ReactNode[] = []
  text.split('\n').forEach((line, i) => {
    const indent = { marginLeft: Math.floor((line.length - line.trimStart().length) / 2) * 16 }
    const bullet = line.match(/^\s*[-*•·]\s+(.*)$/)
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    const quote = line.match(/^\s*>\s?(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (line.trim() === '') blocks.push(<View key={i} style={md.gap} />)
    else if (bullet !== null) blocks.push(<Item key={i} mark="•" text={bullet[1]} style={style} indent={indent} />)
    else if (numbered !== null) blocks.push(<Item key={i} mark={`${numbered[1]}.`} text={numbered[2]} style={style} indent={indent} />)
    else if (quote !== null)
      blocks.push(
        <View key={i} style={[md.quote, indent]}>
          <RichText text={quote[1]} style={[style, md.quoteText]} enums={false} />
        </View>,
      )
    else if (heading !== null) blocks.push(<RichText key={i} text={heading[1]} style={[style, bold]} enums={false} />)
    else blocks.push(<RichText key={i} text={line.trimStart()} style={[style, indent]} enums={false} />)
  })
  return <View style={md.col}>{blocks}</View>
}

function Item({ mark, text, style, indent }: { mark: string; text: string; style: StyleProp<TextStyle>; indent: { marginLeft: number } }) {
  return (
    <View style={[md.item, indent]}>
      <Text style={[style, md.mark]}>{mark}</Text>
      <RichText text={text} style={[style, md.itemText]} enums={false} />
    </View>
  )
}

// 列表里的摘要：去掉 Markdown 标记的纯文本（粗体、代码、行首列表 / 引用 / 标题记号；链接只留文字）
export function plainText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)]|>|#{1,6})\s+/, ''))
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
}

// 电脑：列表项间 4、空行段距 12（docs/desktop-v2.md 间距·对话）；手机保持原来的 2 / 6
const md = StyleSheet.create({
  col: { gap: desktop ? 4 : 2 },
  gap: { height: desktop ? 4 : 6 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 10 },
  quoteText: { color: colors.tx2 },
  item: { flexDirection: 'row', gap: 6 },
  mark: { minWidth: 14 },
  itemText: { flex: 1 },
})
