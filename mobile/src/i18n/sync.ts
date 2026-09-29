import { useEffect } from 'react'
import { hubRequest } from '../api/client'
import type { Language, Settings } from '../api/types'
import { useConfig } from '../config/context'
import type { HubConfig } from '../config/store'
import { writeLanguageSync } from '../config/font-scale'
import { reloadApp } from '../reload'
import { language } from '../i18n'

// 和 i18n.ts 分开放：api/client 等模块要 import t()，这里又要 import client，放一起会循环引用

// 系统页"显示"里切换：有 hub 就先 PUT /settings（带上其余设置不变），再存本地、重载
export async function switchLanguage(next: Language, hub: HubConfig | null): Promise<void> {
  if (hub !== null) {
    const current = await hubRequest<Settings>(hub, 'GET', '/settings')
    await hubRequest<Settings>(hub, 'PUT', '/settings', { ...current, language: next })
  }
  writeLanguageSync(next)
  await reloadApp()
}

// 启动和换 hub 时对一次 hub 的 settings.language；8.9 之前的 hub 没有这个字段，以本地为准
export function useLanguageSync() {
  const { config } = useConfig()
  useEffect(() => {
    if (config.hub === null) return
    hubRequest<Settings>(config.hub, 'GET', '/settings').then((s) => {
      if (s.language === undefined || s.language === language) return
      writeLanguageSync(s.language)
      reloadApp()
    })
  }, [config.hub])
}
