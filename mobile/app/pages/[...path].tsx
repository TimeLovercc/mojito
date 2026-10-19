import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, ExternalLink, History } from 'lucide-react-native'
import { actions } from '../../src/api/client'
import type { PageMeta, PageVersion, PageVersions } from '../../src/api/types'
import { PageFrame } from '../../src/components/PageFrame'
import { StaleBanner } from '../../src/components/Screen'
import { Btn } from '../../src/components/ui'
import { useConfig } from '../../src/config/context'
import { BtnD } from '../../src/desktop/ui'
import { TopBarD } from '../../src/desktop/TopBar'
import { humanize } from '../../src/errors'
import { t } from '../../src/i18n'
import { pageTheme, whoOf } from '../../src/pages'
import { colors, font, overlay, size, space } from '../../src/theme'
import { when } from '../../src/time'
import { useErrorToast, useToast } from '../../src/toast'
import { useHub } from '../../src/use-hub'
import { trackAction, useViewTracking } from '../../src/usage'
import { hoverRow } from '../../src/web-data'
import { useWide } from '../../src/wide'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 签名链接 10 分钟有效；拿到不到 9 分钟的直接用来"在浏览器打开"（同步打开，Safari 不拦弹窗），旧了再要一个
const FRESH_MS = 9 * 60 * 1000

type Frame = { url: string; at: number }

// 页面显示（docs/api.md「页面 · 显示」，网页版和 Mac app；安卓不进这一页，见 src/pages.ts）：
// 页头一行"更新于 · 谁改的 ·「历史」·「在浏览器打开」"，下面 iframe 占满内容区。
// 元数据取自版本列表 GET /pages/{path}/versions 的第一条（不含 html；不在 /pages 里的 _smoke/ 也能按 path 打开），
// 每次回到这一页重取，出了新版本就重新要链接，iframe 换成最新版。
// 历史：同一份版本列表（每条 note + 时间 + 谁），点一条用那一版的链接；看旧版时页头写第几版，可回到最新版
export default function PageScreen() {
  const { path: parts } = useLocalSearchParams<{ path: string[] }>()
  const path = parts.join('/')
  const view = useHub<PageVersions>(`/pages/${path}/versions`)
  const { config } = useConfig()
  const wide = useWide()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const showError = useErrorToast()
  useViewTracking('page_detail')
  // picked：正在看的旧版；null 是最新版
  const [picked, setPicked] = useState<PageVersion | null>(null)
  const [history, setHistory] = useState(false)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [frameError, setFrameError] = useState<Error | null>(null)
  // 版本列表新的在前，页面存在就至少有一版
  const versions = view.data === null ? null : view.data.versions
  const meta = versions === null ? null : versions[0]
  const latest = meta === null ? null : meta.version
  const version = picked === null ? null : picked.version

  useEffect(() => {
    if (latest === null || config.hub === null) return
    let live = true
    setFrame(null)
    setFrameError(null)
    actions.pageLink(config.hub, path, pageTheme, version).then(
      (link) => live && setFrame({ url: link.url, at: Date.now() }),
      (err: Error) => live && setFrameError(err),
    )
    return () => {
      live = false
    }
    // 看最新版时，最新的 version 变了才重新要链接；看旧版时不受影响
  }, [path, version, version === null ? latest : null, config.hub])

  const back = () => (router.canGoBack() ? router.back() : router.replace('/pages'))
  const openHistory = () => {
    if (!history) trackAction('page_history', null)
    setHistory(!history)
  }
  const openInBrowser = () => {
    if (frame !== null && Date.now() - frame.at < FRESH_MS) {
      Linking.openURL(frame.url).catch((err: Error) => showError(t('打不开这一页'), err))
      return
    }
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    actions
      .pageLink(config.hub, path, pageTheme, version)
      .then((link) => Linking.openURL(link.url))
      .catch((err: Error) => showError(t('打不开这一页'), err))
  }

  if (versions === null || meta === null) {
    return (
      <View style={[styles.page, !wide && { paddingTop: insets.top }]}>
        {wide ? (
          <TopBarD title={t('页面')} sub={null} back={{ label: t('返回'), onPress: back }} tools={null} column={null} scrolled />
        ) : (
          <BackRow onPress={back} />
        )}
        <View style={styles.pad}>
          <StaleBanner view={view} />
          {view.error === null ? <ActivityIndicator style={styles.loading} color={colors.tx2} /> : null}
        </View>
      </View>
    )
  }

  const line = metaLine(meta, picked)
  // 宽屏用桌面按钮（顶栏右边），手机用普通按钮（标题下一行）
  const tools = wide ? (
    <>
      {picked === null ? null : <BtnD label={t('看最新版')} kind="accept" size="sm" onPress={() => setPicked(null)} disabled={false} />}
      <BtnD label={t('历史')} kind={history ? 'neutral' : 'ghost'} size="sm" icon={History} onPress={openHistory} disabled={false} />
      <BtnD label={t('在浏览器打开')} kind="ghost" size="sm" icon={ExternalLink} onPress={openInBrowser} disabled={false} />
    </>
  ) : (
    <>
      {picked === null ? null : <Btn label={t('看最新版')} primary onPress={() => setPicked(null)} />}
      <Btn label={t('历史')} icon={History} onPress={openHistory} />
      <Btn label={t('在浏览器打开')} icon={ExternalLink} onPress={openInBrowser} />
    </>
  )
  const body = (
    <View style={styles.frame}>
      {frameError !== null ? (
        <FrameError err={frameError} />
      ) : frame === null ? (
        <ActivityIndicator style={styles.loading} color={colors.tx2} />
      ) : (
        <PageFrame url={frame.url} title={meta.title} />
      )}
    </View>
  )
  const panel = history ? <VersionList versions={versions} picked={version} onPick={setPicked} wide={wide} /> : null

  if (wide) {
    return (
      <View style={styles.page}>
        <TopBarD title={meta.title} sub={line} back={{ label: t('返回'), onPress: back }} tools={tools} column={null} scrolled />
        {view.error === null ? null : (
          <View style={styles.pad}>
            <StaleBanner view={view} />
          </View>
        )}
        <View style={styles.split}>
          {body}
          {panel}
        </View>
      </View>
    )
  }
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <BackRow onPress={back} />
        <Text style={styles.title} numberOfLines={2}>
          {meta.title}
        </Text>
        <Text style={styles.meta}>{line}</Text>
        <View style={styles.tools}>{tools}</View>
        <StaleBanner view={view} />
      </View>
      {panel}
      {body}
    </View>
  )
}

// "更新于 今天 10:00 · experience-b2"；看旧版时"第 3 版 · 10月14日 09:00 · experience-b2"
function metaLine(meta: PageMeta, picked: PageVersion | null): string {
  if (picked === null) return `${t('更新于 {at}', { at: when(meta.updated_at) })} · ${whoOf(meta.updated_by)}`
  return `${t('第 {n} 版', { n: picked.version })} · ${when(picked.updated_at)} · ${whoOf(picked.updated_by)}`
}

function BackRow({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.back} hitSlop={8}>
      <ChevronLeft size={16} color={colors.tx2} />
      <Text style={styles.backText}>{t('返回')}</Text>
    </Pressable>
  )
}

function FrameError({ err }: { err: Error }) {
  const h = humanize(err)
  return (
    <View style={styles.pad}>
      <Text style={styles.error}>{t('打不开这一页')}</Text>
      <Text style={styles.detail} selectable>
        {h.detail}
      </Text>
    </View>
  )
}

// 版本列表（倒序）：第一条是最新版，点它回到最新
function VersionList({
  versions,
  picked,
  onPick,
  wide,
}: {
  versions: PageVersion[]
  picked: number | null
  onPick: (v: PageVersion | null) => void
  wide: boolean
}) {
  return (
    <View style={wide ? styles.side : styles.drop}>
      <ScrollView contentContainerStyle={styles.versions}>
        {versions.map((v, i) => {
          const on = picked === null ? i === 0 : picked === v.version
          return (
            <Pressable key={v.version} onPress={() => onPick(i === 0 ? null : v)} style={[styles.ver, on && styles.verOn]} {...hoverRow}>
              <View style={styles.verTop}>
                <Text style={styles.verNo}>{`v${v.version}`}</Text>
                {i === 0 ? <Text style={styles.verLatest}>{t('最新')}</Text> : null}
                <View style={styles.grow} />
                <Text style={styles.verTime}>{when(v.updated_at)}</Text>
              </View>
              <Text style={styles.verNote}>{v.note}</Text>
              <Text style={styles.verWho}>{whoOf(v.updated_by)}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: space.gutter, paddingTop: 12, gap: 8 },
  loading: { marginTop: 40 },
  split: { flex: 1, flexDirection: 'row', minHeight: 0 },
  frame: { flex: 1, minWidth: 0, minHeight: 0 },
  head: { gap: 6, paddingHorizontal: space.gutter, paddingTop: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: overlay.hair },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { ...font.regular, fontSize: size.body, color: colors.tx2 },
  title: { ...font.bold, fontSize: size.page, color: colors.tx },
  meta: { ...font.regular, fontSize: size.small, color: colors.tx2 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  error: { ...font.medium, fontSize: size.body, color: colors.bad },
  detail: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  // 宽屏：右边 320 的一栏；手机：页头下面一块，最多占半屏
  side: { width: 320, borderLeftWidth: 1, borderLeftColor: overlay.hair },
  drop: { maxHeight: '45%', borderBottomWidth: 1, borderBottomColor: overlay.hair },
  versions: { padding: 8, gap: 2 },
  ver: { gap: 3, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 },
  verOn: { backgroundColor: overlay.selected },
  verTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  verNo: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  verLatest: { ...font.medium, fontSize: size.small, color: colors.brand },
  grow: { flex: 1 },
  verTime: { ...font.mono, fontSize: size.small, color: colors.tx3 },
  verNote: { ...font.regular, fontSize: size.secondary, lineHeight: Math.round(size.secondary * 1.5), color: colors.tx },
  verWho: { ...font.regular, fontSize: size.small, color: colors.tx3 },
})
