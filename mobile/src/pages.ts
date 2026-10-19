import { Linking, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { actions } from './api/client'
import type { PageMeta } from './api/types'
import { useConfig } from './config/context'
import { t } from './i18n'
import { isDark } from './theme'
import { useErrorToast, useToast } from './toast'
import { trackView } from './usage'

// 页面（docs/api.md「页面」）：任何会话都能读写的固定路径 HTML 页。app 只看不改：
// 网页版和 Mac app 用 iframe 加载 hub 给的签名链接（app/pages/[...path].tsx），安卓用系统浏览器打开（不加 webview）

// 签名链接的深浅色跟 app 当前一致
export const pageTheme: 'dark' | 'light' = isDark ? 'dark' : 'light'

// 顶层主题的显示名；api.md 说顶层先用这四个、不限死，其他的照 path 原样显示
const TOPS: Record<string, string> = { life: '生活', research: '研究', infra: '基础设施', notes: '笔记' }

export function topName(top: string): string {
  return top in TOPS ? t(TOPS[top]) : top
}

// 按 path 第一段分组；hub 已按 path 排好序，组和组内都保持这个顺序
export function groupPages(pages: PageMeta[]): { top: string; pages: PageMeta[] }[] {
  const groups: { top: string; pages: PageMeta[] }[] = []
  for (const p of pages) {
    const top = p.path.split('/')[0]
    const last = groups[groups.length - 1]
    if (last !== undefined && last.top === top) last.pages.push(p)
    else groups.push({ top, pages: [p] })
  }
  return groups
}

// "session:experience-b2" 显示会话名；令牌角色（worker 等）原样显示
export function whoOf(updatedBy: string): string {
  return updatedBy.startsWith('session:') ? updatedBy.slice('session:'.length) : updatedBy
}

// 点一个页面：网页（含 Mac app）进页面显示页；安卓先要签名链接，再交给系统浏览器
export function useOpenPage(): (path: string) => void {
  const router = useRouter()
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  return (path) => {
    if (Platform.OS === 'web') {
      router.push({ pathname: '/pages/[...path]', params: { path: path.split('/') } })
      return
    }
    if (config.hub === null) {
      toast(t('先到"系统"页填 hub 地址和令牌'), true)
      return
    }
    actions
      .pageLink(config.hub, path, pageTheme, null)
      .then((link) => Linking.openURL(link.url))
      // 安卓上页面在浏览器里看，打开成功也算看了一次详情
      .then(() => trackView('page_detail'))
      .catch((err: Error) => showError(t('打不开这一页'), err))
  }
}
