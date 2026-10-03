import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { usePathname, type ErrorBoundaryProps } from 'expo-router'
import { RotateCw } from 'lucide-react-native'
import { reportRenderError } from '../errors'
import { t } from '../i18n'
import { colors, font, size } from '../theme'
import { Btn } from './ui'

// 页面级错误边界（每个路由文件 export { PageError as ErrorBoundary }）：某页渲染出错时只在这一页显示
// "这一页出错了" + 错误信息 + 重新加载，侧栏和别的页照常用，不再整窗白屏。出错时上报 client_error，
// 并 console.error 一次（Mac app 的 shell 会把它写进 webview.log）
export function PageError({ error, retry }: ErrorBoundaryProps) {
  const page = usePathname()
  // 每个错误只记一次：之后切到别的页，路径变了也不再记
  const [at] = useState(page)
  useEffect(() => {
    console.error(`页面出错 ${at}`, error)
    reportRenderError(at)
  }, [error, at])
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{t('这一页出错了')}</Text>
      <Text style={styles.detail} selectable>
        {error.message}
      </Text>
      <View style={styles.row}>
        <Btn label={t('重新加载')} icon={RotateCw} onPress={retry} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 24, gap: 10 },
  title: { ...font.semibold, fontSize: size.title, color: colors.tx },
  detail: { ...font.mono, fontSize: size.small, color: colors.tx2 },
  row: { flexDirection: 'row' },
})
