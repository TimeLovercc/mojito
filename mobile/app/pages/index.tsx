import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Search, X } from 'lucide-react-native'
import type { PageMeta, PagesList } from '../../src/api/types'
import { PageRow } from '../../src/components/PageRow'
import { Screen } from '../../src/components/Screen'
import { Card, Empty, Rows, Section } from '../../src/components/ui'
import { t } from '../../src/i18n'
import { groupPages, topName } from '../../src/pages'
import { colors, desktop, font, overlay, radii, size } from '../../src/theme'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { useWide } from '../../src/wide'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

// 页面列表（docs/api.md「页面」）：按 path 第一段分组，每行标题 + 摘要 + 本地短时间。
// 宽屏从侧边栏进来，是顶层页；手机从项目页顶部的"页面"进来，左上角返回项目。
// 顶部搜索框按标题、摘要、分类路径筛（不分大小写）；⌘F / Ctrl+F 跳到这里并聚焦（focus=时间戳，见 src/wide.tsx）
export default function PagesScreen() {
  const view = useHub<PagesList>('/pages')
  const wide = useWide()
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  const [query, setQuery] = useState('')
  useViewTracking('pages')
  const q = query.trim().toLowerCase()
  return (
    <Screen
      view={view}
      head={wide ? { kind: 'title', title: t('页面') } : { kind: 'back', label: t('项目') }}
      top={<SearchBox value={query} onChange={setQuery} focus={focus === undefined ? null : focus} />}
    >
      {({ pages }) => {
        if (pages.length === 0) return <Empty text={t('还没有页面')} />
        const shown = q === '' ? pages : pages.filter((p) => matches(p, q))
        if (shown.length === 0) return <Empty text={t('没有匹配的页面')} />
        return groupPages(shown).map((g) => (
          <Section key={g.top} title={topName(g.top)} right={String(g.pages.length)}>
            <Card>
              <Rows>
                {g.pages.map((p) => (
                  <PageRow key={p.path} page={p} />
                ))}
              </Rows>
            </Card>
          </Section>
        ))
      }}
    </Screen>
  )
}

// 分类路径是 path 去掉最后一段（research/loaflog/photo-options → research/loaflog），不比最后一段：
// 否则搜 opt 会带出 photo-options；顶层另比显示名（生活）
function matches(p: PageMeta, q: string): boolean {
  const parts = p.path.split('/')
  const category = parts.slice(0, -1).join('/')
  return [p.title, p.summary, category, topName(parts[0])].some((s) => s.toLowerCase().includes(q))
}

// focus：路由参数 focus 的值，每次变化（⌘F / Ctrl+F）都把光标放进搜索框并选中已有的字；Esc 清空
function SearchBox({ value, onChange, focus }: { value: string; onChange: (v: string) => void; focus: string | null }) {
  const input = useRef<TextInput>(null)
  useEffect(() => {
    if (focus === null) return
    // 已在框里时先失焦：再聚焦才会触发 selectTextOnFocus，连按 ⌘F 也选中已有的字
    input.current?.blur()
    input.current?.focus()
  }, [focus])
  return (
    <View style={styles.box}>
      <Search size={15} color={colors.tx3} />
      <TextInput
        ref={input}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        onKeyPress={(e) => e.nativeEvent.key === 'Escape' && onChange('')}
        placeholder={t('搜索页面')}
        placeholderTextColor={colors.tx3}
        autoCapitalize="none"
        autoCorrect={false}
        selectTextOnFocus
        returnKeyType="search"
      />
      {value === '' ? null : (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel={t('清空')}>
          <X size={15} color={colors.tx3} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: desktop ? 34 : 42,
    paddingHorizontal: 12,
    borderRadius: radii.input,
    backgroundColor: desktop ? overlay.fill : colors.raised,
  },
  input: { ...font.regular, flex: 1, minWidth: 0, height: '100%', fontSize: desktop ? size.secondary : size.body, color: colors.tx },
})
