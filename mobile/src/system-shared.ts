import { useCallback, useState } from 'react'
import { Linking } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Updates from 'expo-updates'
import { actions } from './api/client'
import type { Language, Settings as NotifySettings } from './api/types'
import { useConfig } from './config/context'
import { writeColorSchemeSync, writeFontScaleSync } from './config/font-scale'
import { language, t } from './i18n'
import { switchLanguage } from './i18n/sync'
import { pwa } from './pwa'
import { useRefresh } from './refresh'
import { reloadApp } from './reload'
import { colorSchemeSetting, fontScaleName, type ColorSchemeSetting, type FontScaleName } from './theme'
import type { TauriApi } from './tauri-api'
import { when } from './time'
import { useErrorToast, useToast } from './toast'
import { trackAction } from './usage'
import { syncWindowTheme } from './window-theme'

// 系统页的数据和动作：手机页面（app/system.tsx）和电脑页面（src/desktop/SystemWide.tsx）共用，两边只是画法不同

export function interval(s: number): string {
  if (s % 86400 === 0) return t('{n} 天', { n: s / 86400 })
  if (s % 3600 === 0) return t('{n} 小时', { n: s / 3600 })
  if (s % 60 === 0) return t('{n} 分钟', { n: s / 60 })
  return t('{n} 秒', { n: s })
}

// 外部授权失效时怎么修
export const FIX_GOOGLE = t('在 Mac 上跑 uv run hub/deploy/google-auth.py 重新授权，再跑 hub/deploy/install-secrets.sh')
export const FIX_CLAUDE = t('跑 claude setup-token 生成新令牌，再跑 hub/deploy/install-secrets.sh')

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// 显示：字号（在安卓系统字体大小之上再放大）和深浅色。都在样式创建时定下，选了之后重载一次生效
export const SCALES: [FontScaleName, string][] = [
  ['standard', t('标准')],
  ['large', t('大')],
  ['xlarge', t('特大')],
]
export const SCHEMES: [ColorSchemeSetting, string][] = [
  ['system', t('跟随系统')],
  ['dark', t('深色')],
  ['light', t('浅色')],
]
export function pickScale(k: FontScaleName) {
  if (k === fontScaleName) return
  trackAction('settings_save', { what: 'font_scale', value: k })
  writeFontScaleSync(k)
  reloadApp()
}
export function pickScheme(k: ColorSchemeSetting) {
  if (k === colorSchemeSetting) return
  trackAction('settings_save', { what: 'color_scheme', value: k })
  writeColorSchemeSync(k)
  syncWindowTheme(k)
  reloadApp()
}

// 语言名不翻译：切换的人要认得出自己的语言（design.md 8.9）
export const LANGUAGES: [Language, string][] = [
  ['zh', '中文'],
  ['en', 'English'],
]
export function usePickLanguage(): (k: Language) => void {
  const { config } = useConfig()
  const showError = useErrorToast()
  return (k) => {
    if (k === language) return
    trackAction('settings_save', { what: 'language', value: k })
    switchLanguage(k, config.hub).catch((err: Error) => showError(t('没切换成'), err))
  }
}

// 提前复盘：POST /jobs {kind: draft_review}，Mac 起草复盘和下一期计划
export function useStartReview(): { busy: boolean; start: () => Promise<void> } {
  const { config } = useConfig()
  const { bump } = useRefresh()
  const toast = useToast()
  const showError = useErrorToast()
  const [busy, setBusy] = useState(false)
  const start = async () => {
    if (config.hub === null) {
      toast(t('先在下面填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      const job = await actions.requestReview(config.hub)
      trackAction('review_start', null)
      toast(job.status === 'queued' ? t('复盘已排队，Mac 醒来后起草复盘和下一期计划') : t('复盘开始了'), false)
      bump()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没能开始复盘'), err)
    } finally {
      setBusy(false)
    }
  }
  return { busy, start }
}

export function useOpenOrca(): () => void {
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  return () => {
    if (config.orcaUrl === null) {
      toast(t('先在下面填 Orca 链接'), true)
      return
    }
    trackAction('open_orca', null)
    Linking.openURL(config.orcaUrl).catch((err: Error) => showError(t('打不开 Orca'), err))
  }
}

// 早晚通知：GET/PUT /settings，三个字段一起提交
export function useNotifyForm(current: NotifySettings, onSaved: () => Promise<void>) {
  const { config } = useConfig()
  const toast = useToast()
  const showError = useErrorToast()
  const [morning, setMorning] = useState(current.morning_at)
  const [evening, setEvening] = useState(current.evening_at)
  const [eveningOn, setEveningOn] = useState(current.evening_enabled)
  const [busy, setBusy] = useState(false)
  const valid = HHMM.test(morning) && HHMM.test(evening)
  const changed = morning !== current.morning_at || evening !== current.evening_at || eveningOn !== current.evening_enabled
  const save = async () => {
    if (config.hub === null) {
      toast(t('先在下面填 hub 地址和令牌'), true)
      return
    }
    setBusy(true)
    try {
      await actions.putSettings(config.hub, { ...current, morning_at: morning, evening_at: evening, evening_enabled: eveningOn })
      trackAction('settings_save', { what: 'notify', evening_enabled: eveningOn })
      toast(t('通知时间已保存'), false)
      await onSaved()
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没保存上'), err)
    } finally {
      setBusy(false)
    }
  }
  return { morning, setMorning, evening, setEvening, eveningOn, setEveningOn, busy, valid, changed, save }
}

// 连接设置：hub 地址、app 令牌、Orca 链接，存在本机
export function useConnectionForm() {
  const { config, update } = useConfig()
  const toast = useToast()
  const [hubUrl, setHubUrl] = useState(config.hub === null ? '' : config.hub.hubUrl)
  const [token, setToken] = useState(config.hub === null ? '' : config.hub.token)
  const [orcaUrl, setOrcaUrl] = useState(config.orcaUrl === null ? '' : config.orcaUrl)
  const save = async () => {
    const url = hubUrl.trim()
    const tok = token.trim()
    if ((url === '') !== (tok === '')) {
      toast(t('hub 地址和令牌要一起填（或一起清空）'), true)
      return
    }
    const orca = orcaUrl.trim()
    await update({ hub: url === '' ? null : { hubUrl: url, token: tok }, orcaUrl: orca === '' ? null : orca })
    toast(t('已保存'), false)
  }
  return { hubUrl, setHubUrl, token, setToken, orcaUrl, setOrcaUrl, save }
}

// Mac app 开机自启（desktop 的 autostart 插件；首次启动 desktop 默认打开）。null = 还在读
export function useAutostart(api: TauriApi): { on: boolean | null; toggle: (next: boolean) => void } {
  const showError = useErrorToast()
  const [on, setOn] = useState<boolean | null>(null)
  useFocusEffect(
    useCallback(() => {
      api.autostart.isEnabled().then(setOn, (err: string) => showError(t('读不到开机自启'), new Error(err)))
    }, [api]),
  )
  const toggle = (next: boolean) =>
    (next ? api.autostart.enable() : api.autostart.disable()).then(
      () => setOn(next),
      (err: string) => showError(t('没改成'), new Error(err)),
    )
  return { on, toggle }
}

// 当前运行的 JS 包：空中更新的 updateId / 创建时间，或 APK 内置包；用来确认手机上是哪个版本。
// 开发模式和网页模式没有 updateId；网页版（PWA）显示构建号（和 /app/version.json 的 build 对得上）
export function versionLines(): string[] {
  if (pwa !== null) return [t('网页版 build {build}', { build: pwa.build })]
  if (Updates.updateId === null) return [t('JS 包：开发 / 网页模式，没有 updateId')]
  return [
    t('JS 包：{kind} {id}', { kind: Updates.isEmbeddedLaunch ? t('APK 内置') : t('空中更新'), id: Updates.updateId }),
    ...(Updates.createdAt === null ? [] : [t('创建于 {when}', { when: when(Updates.createdAt.toISOString()) })]),
    `runtime ${Updates.runtimeVersion === null ? t('无') : Updates.runtimeVersion.slice(0, 12)} · channel ${Updates.channel === null ? t('无') : Updates.channel}`,
  ]
}
