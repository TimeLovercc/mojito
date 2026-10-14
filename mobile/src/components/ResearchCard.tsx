import { Children, useState, type ReactNode } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { ChatLink, Project } from '../api/types'
import { t } from '../i18n'
import { openPath } from '../overview'
import { RUN, STAGE, STAGES, cardText, chatHref, end, runOf, type RunShown } from '../research'
import { tauri } from '../tauri'
import { colors, desktop, font, isDark, overlay, size, txAlpha } from '../theme'
import { when } from '../time'
import { useErrorToast, useToast } from '../toast'
import { useHover } from '../hover'
import { Markdown } from './RichText'

// 研究卡片（design.md 8.13，照研究地图演示页）：Mac 抽屉和手机全屏页共用。顶上位置、名字、三个按钮（复制全部 / Claude / ChatGPT）；
// 研究项目依次是进展（运行状态 + 五步）、最新状态（核心想法、主实验、贡献、状态、论文、评论，待你决定折在评论下）、项目发展、状态历史；
// 生活项目只有状态
export function ResearchCard({
  project: p,
  place,
  life,
  chats,
}: {
  project: Project
  place: string
  life: boolean
  chats: { claude: ChatLink[]; chatgpt: ChatLink[] }
}) {
  const o = p.overview
  const card = o === null ? null : o.card
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.place}>{place}</Text>
        <Text style={styles.title}>{p.title}</Text>
        {p.repo_path === null ? null : <Text style={styles.path}>{p.repo_path}</Text>}
        <Buttons project={p} place={place} life={life} chats={chats} />
      </View>
      {life ? (
        <Rows>
          <Row label={t('状态')}>{o === null || o.status === null ? <None /> : <Para text={end(o.status)} />}</Row>
        </Rows>
      ) : (
        <>
          <Rows>
            <Row label={t('进展')}>
              <Progress run={runOf(p, false)} stage={card === null ? null : card.stage} />
            </Row>
          </Rows>
          <SecHead title={t('最新状态')} sub={o === null ? null : t('{at} 由项目会话更新', { at: when(o.checked_at) })} />
          {o === null ? (
            <None />
          ) : (
            <Rows>
              <Row label={t('核心想法')}>{o.one_liner === null ? <None /> : <Para text={end(o.one_liner)} />}</Row>
              {card === null || card.main_exp === null ? null : (
                <Row label={t('主实验')}>
                  <Para text={end(card.main_exp)} />
                </Row>
              )}
              {card === null || card.contribution === null ? null : (
                <Row label={t('贡献')}>
                  <Para text={end(card.contribution)} />
                </Row>
              )}
              <Row label={t('状态')}>{o.status === null ? <None /> : <Para text={end(o.status)} />}</Row>
              {o.paper === null ? null : (
                <Row label={t('论文')}>
                  <PaperBlock paper={o.paper} />
                </Row>
              )}
              {card === null ? null : (
                <Row label={t('评论')}>
                  {card.comment === null ? <Text style={styles.none}>{t('还没有评论。')}</Text> : <Para text={end(card.comment)} />}
                  {card.decisions.length === 0 ? null : (
                    <Fold label={t('待你决定 {n} 项', { n: card.decisions.length })}>
                      {card.decisions.map((d, i) => (
                        <Text key={i} style={styles.decision}>
                          {d}
                        </Text>
                      ))}
                    </Fold>
                  )}
                </Row>
              )}
            </Rows>
          )}
          {card === null || card.development.length === 0 ? null : (
            <>
              <SecHead title={t('项目发展')} sub={t('从最初的想法到现在')} />
              <Rows>
                {card.development.map((s, i) => (
                  <Row key={i} label={s.title}>
                    <Para text={s.text} />
                  </Row>
                ))}
              </Rows>
            </>
          )}
          {card === null || card.history.length === 0 ? null : (
            <>
              <SecHead title={t('状态历史')} sub={t('最新的在上面')} />
              <View style={styles.hist}>
                {card.history.map((h, i) => (
                  <View key={i} style={styles.hitem}>
                    <Text style={styles.htime}>{when(h.at)}</Text>
                    <Text style={styles.htext}>{h.change}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {o !== null && card === null ? <Text style={styles.none}>{t('这个项目的卡片还没换成研究卡片的格式。')}</Text> : null}
        </>
      )}
    </View>
  )
}

function Buttons({ project, place, life, chats }: { project: Project; place: string; life: boolean; chats: { claude: ChatLink[]; chatgpt: ChatLink[] } }) {
  const toast = useToast()
  const showError = useErrorToast()
  const copy = () =>
    Clipboard.setStringAsync(cardText(project, place, life)).then(
      () => toast(t('已复制整张卡片'), false),
      (err: Error) => showError(t('复制失败'), err),
    )
  // 有几个对话时打开最新的那个（地图文件里按新到旧排）。Mac 上 ChatGPT 对话交给外壳的 open_chat_tab：
  // Chrome 里已经开着这个对话就切过去，不再新开标签
  const open = (app: 'claude' | 'chatgpt') => {
    const chat = chats[app][0]
    const opened =
      app === 'chatgpt' && tauri !== null
        ? tauri.core.invoke<string>('open_chat_tab', { url: chat.url }).catch((err: string) => {
            throw new Error(err)
          })
        : Linking.openURL(chatHref(app, chat))
    opened.catch((err: Error) => showError(t('打不开链接'), err))
  }
  return (
    <View style={styles.btns}>
      <Btn label={t('复制全部')} onPress={copy} disabled={false} />
      <Btn label="Claude" onPress={() => open('claude')} disabled={chats.claude.length === 0} />
      <Btn label="ChatGPT" onPress={() => open('chatgpt')} disabled={chats.chatgpt.length === 0} />
    </View>
  )
}

// 按钮：平时浅灰底，悬停明显加深，按下再深一档（箭头光标不变，docs/desktop-v2.md"原生 Mac 手感"）
function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const [hovered, hover] = useHover()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      {...hover}
      style={({ pressed }) => [styles.btn, !disabled && hovered && styles.btnHover, !disabled && pressed && styles.btnPressed, disabled && styles.btnOff]}
    >
      <Text style={[styles.btnText, disabled && styles.btnTextOff]}>{label}</Text>
    </Pressable>
  )
}

export function RunBox({ run, small }: { run: RunShown; small: boolean }) {
  const s = small ? 14 : 16
  return (
    <View style={[styles.box, { width: s, height: s, backgroundColor: RUN[run].color }]} accessibilityLabel={RUN[run].label}>
      <Text style={[styles.boxText, { fontSize: small ? 8 : 9 }]}>{RUN[run].glyph}</Text>
    </View>
  )
}

function Progress({ run, stage }: { run: RunShown; stage: (typeof STAGES)[number] | null }) {
  const si = stage === null ? -1 : STAGES.indexOf(stage)
  return (
    <View style={styles.prog}>
      <View style={styles.runLine}>
        <RunBox run={run} small={false} />
        <Text style={styles.para}>
          {stage === null ? RUN[run].label : t('{run}，处在第 {n} 步「{stage}」', { run: RUN[run].label, n: si + 1, stage: STAGE[stage] })}
        </Text>
      </View>
      {stage === null ? null : (
        <View style={styles.track}>
          {STAGES.map((s, i) => (
            <View key={s} style={[styles.step, i < si && styles.stepDone, i === si && styles.stepNow]}>
              <Text style={[styles.stepText, i === si && styles.stepTextNow]}>{`${i + 1} ${STAGE[s]}`}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

type Paper = NonNullable<NonNullable<Project['overview']>['paper']>
function PaperBlock({ paper: p }: { paper: Paper }) {
  const showError = useErrorToast()
  const head = [p.format, p.pending === null ? null : p.pending === 0 ? t('没有 pending') : t('还有 {n} 处 pending', { n: p.pending })]
    .filter((x): x is string => x !== null)
    .join('，')
  // 本地文件只有 Mac app 能打开
  const links = tauri === null ? [] : ([
    [t('PDF'), p.pdf_path],
    [t('评审'), p.review_path],
    [t('文件夹'), p.dir_path],
  ] as const).filter((x): x is readonly [string, string] => x[1] !== null)
  return (
    <View style={styles.paper}>
      {p.title === null ? null : <Text style={styles.paperTitle}>{p.title}</Text>}
      {head === '' ? null : <Text style={styles.para}>{head}</Text>}
      {p.note === null ? null : <Para text={end(p.note)} />}
      {links.length === 0 ? null : (
        <View style={styles.btns}>
          {links.map(([label, path]) => (
            <Btn key={label} label={label} onPress={() => openPath(path).catch((err: Error) => showError(t('打不开'), err))} disabled={false} />
          ))}
        </View>
      )}
    </View>
  )
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [hovered, hover] = useHover()
  return (
    <View style={styles.fold}>
      <Pressable onPress={() => setOpen(!open)} style={styles.foldHead} {...hover}>
        <Text style={[styles.foldText, hovered && styles.foldTextHover]}>{label}</Text>
        {open ? <ChevronDown size={14} color={colors.brand} /> : <ChevronRight size={14} color={colors.brand} />}
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  )
}

function SecHead({ title, sub }: { title: string; sub: string | null }) {
  return (
    <View style={styles.secHead}>
      <Text style={styles.secTitle}>{title}</Text>
      {sub === null ? null : <Text style={styles.secSub}>{sub}</Text>}
    </View>
  )
}

// 一张卡里的若干行，行间一条细线（第一行上面没有）
function Rows({ children }: { children: ReactNode }) {
  return (
    <View style={styles.rows}>
      {Children.toArray(children).map((row, i) => (
        <View key={i} style={i === 0 ? null : styles.rowLine}>
          {row}
        </View>
      ))}
    </View>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.cell}>{children}</View>
    </View>
  )
}

// 正文按 Markdown 渲染（项目发展里有 **加粗** 和链接）
function Para({ text }: { text: string }) {
  return <Markdown text={text} style={styles.para} />
}

function None() {
  return <Text style={styles.none}>{t('没有')}</Text>
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  head: { gap: 4 },
  place: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  title: { ...font.semibold, fontSize: size.page, color: colors.tx },
  path: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  btn: { height: 28, paddingHorizontal: 12, borderRadius: 6, justifyContent: 'center', backgroundColor: overlay.fill },
  btnHover: { backgroundColor: txAlpha(isDark ? 0.16 : 0.12) },
  btnPressed: { backgroundColor: txAlpha(isDark ? 0.22 : 0.18) },
  btnOff: { opacity: 0.45 },
  btnText: { ...font.medium, fontSize: size.secondary, color: colors.tx },
  btnTextOff: { color: colors.tx3 },
  rows: { borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 4 },
  // 电脑上标签在左列；手机窄，标签在正文上面
  row: desktop ? { flexDirection: 'row', gap: 12, paddingVertical: 10 } : { gap: 4, paddingVertical: 10 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: overlay.rowLine },
  label: { ...font.regular, width: desktop ? 72 : undefined, fontSize: size.small, lineHeight: 20, color: colors.tx3 },
  cell: { flex: 1, minWidth: 0, gap: 6 },
  para: { ...font.regular, fontSize: size.body, lineHeight: Math.round(size.body * 1.6), color: colors.tx },
  none: { ...font.regular, fontSize: size.secondary, color: colors.tx3 },
  decision: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.6), color: colors.tx, paddingVertical: 4 },
  secHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  secTitle: { ...font.semibold, fontSize: size.title, color: colors.tx },
  secSub: { ...font.regular, fontSize: size.small, color: colors.tx3 },
  hist: { gap: 10 },
  hitem: { flexDirection: 'row', gap: 12 },
  htime: { ...font.mono, width: 84, fontSize: size.small, lineHeight: Math.round(size.secondary * 1.6), color: colors.tx3 },
  htext: { ...font.regular, flex: 1, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.6), color: colors.tx },
  box: { borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  boxText: { color: '#ffffff', lineHeight: 12 },
  prog: { gap: 8 },
  runLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: overlay.fill },
  stepDone: { backgroundColor: colors.okSoft },
  stepNow: { backgroundColor: colors.brand },
  stepText: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  stepTextNow: { ...font.medium, color: colors.onBrand },
  paper: { gap: 4 },
  paperTitle: { ...font.semibold, fontSize: size.body, color: colors.tx },
  fold: { marginTop: 4 },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  foldText: { ...font.medium, fontSize: size.secondary, color: colors.brand },
  foldTextHover: { textDecorationLine: 'underline' },
  foldBody: { gap: 2, paddingTop: 4 },
})
