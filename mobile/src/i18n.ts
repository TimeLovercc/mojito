import type { Language } from './api/types'
import { readLanguageSync } from './config/font-scale'
import { EN } from './i18n/en'

// 界面语言（design.md 8.9）：界面文字以中文原文为键，英文时查 i18n/en.ts，缺翻译直接报错。
// 语言和字号一样在 JS 加载时同步读定，切换后重载一次；所以模块顶层的 t() 也拿到对的语言。
// 本地还没存过（新装、或 8.9 之前的版本）时先按中文显示，useLanguageSync 从 hub 拿到 settings.language 后改过来。
const stored = readLanguageSync()
export const language: Language = stored === null ? 'zh' : (stored as Language)

type Vars = Record<string, string | number>

function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`t() 缺少变量 {${k}}：${text}`)
    return String(vars[k])
  })
}

export function t(zh: string, vars?: Vars): string {
  let text = zh
  if (language === 'en') {
    if (!(zh in EN)) throw new Error(`缺英文翻译：${zh}`)
    text = EN[zh]
  }
  return vars === undefined ? text : fill(text, vars)
}

// 同一个中文在不同位置要不同英文时（按钮"关闭" Close / 状态"关闭" Closed），加一个上下文：英文表的键是"上下文|中文"
export function tc(context: string, zh: string): string {
  return language === 'en' ? t(`${context}|${zh}`) : zh
}
