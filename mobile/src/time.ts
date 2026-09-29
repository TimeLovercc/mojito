import { language, t } from './i18n'

// hub 输出的时间一律 UTC；显示和按天计算一律用用户时区（docs/api.md）。时区在构建时从
// EXPO_PUBLIC_MOJITO_TIMEZONE 读（mobile/.env，和 hub 的 MOJITO_TIMEZONE 相同），没设就报错。
const ZONE_SETTING = process.env.EXPO_PUBLIC_MOJITO_TIMEZONE
if (ZONE_SETTING === undefined || ZONE_SETTING === '') {
  // 报错里不写变量全名：网页版产物检查（hub/deploy/deploy-web.sh）不允许出现那个前缀
  throw new Error('构建时没有设置时区：在 mobile/.env 写上你的 IANA 时区（和 hub 的时区相同），见 mobile/.env.example')
}
const ZONE: string = ZONE_SETTING
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'short',
  hour12: false,
})

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

function zonedParts(date: Date): Parts {
  const p: Record<string, string> = {}
  for (const part of partsFormat.formatToParts(date)) p[part.type] = part.value
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24, // 有的引擎午夜给 24
    minute: Number(p.minute),
    weekday: WEEKDAY_INDEX[p.weekday],
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

// 日期一律用 "YYYY-MM-DD" 字符串（本地日历日）
export function ymdOf(date: Date): string {
  const p = zonedParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export const todayYmd = () => ymdOf(new Date())

function ymdUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymdUtc(ymd) + n * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// b - a，单位天
export function daysBetween(a: string, b: string): number {
  return Math.round((ymdUtc(b) - ymdUtc(a)) / 86400000)
}

export function weekdayOf(ymd: string): string {
  return t(WEEKDAYS[new Date(ymdUtc(ymd)).getUTCDay()])
}

// "9/24"
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

// "9月24日"，跨年带年份；英文 "Sep 24" / "Sep 24, 2025"
export function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const thisYear = y === Number(todayYmd().slice(0, 4))
  if (language === 'en') return thisYear ? `${MONTHS_EN[m - 1]} ${d}` : `${MONTHS_EN[m - 1]} ${d}, ${y}`
  const year = thisYear ? '' : `${y}年`
  return `${year}${m}月${d}日`
}

export function clock(iso: string): string {
  const p = zonedParts(new Date(iso))
  return `${pad(p.hour)}:${pad(p.minute)}`
}

// 时间线的分日标题："今天" / "昨天" / "9月25日 周四"；英文 "Thu, Sep 25"
export function dayLabel(ymd: string): string {
  const diff = daysBetween(ymd, todayYmd())
  if (diff === 0) return t('今天')
  if (diff === 1) return t('昨天')
  return language === 'en' ? `${weekdayOf(ymd)}, ${longDate(ymd)}` : `${longDate(ymd)} ${weekdayOf(ymd)}`
}

// "今天 10:00" / "明天 10:00" / "昨天 22:05" / "9月30日 12:00"
export function when(iso: string): string {
  const ymd = ymdOf(new Date(iso))
  const diff = daysBetween(todayYmd(), ymd)
  const names: Record<number, string> = { [-1]: t('昨天'), 0: t('今天'), 1: t('明天') }
  const day = diff in names ? names[diff] : longDate(ymd)
  return `${day} ${clock(iso)}`
}

export function ago(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return t('刚刚')
  if (s < 3600) return t('{n} 分钟前', { n: Math.floor(s / 60) })
  if (s < 86400) return t('{n} 小时前', { n: Math.floor(s / 3600) })
  return t('{n} 天前', { n: Math.floor(s / 86400) })
}

export function greeting(): string {
  const h = zonedParts(new Date()).hour
  if (h < 5) return t('夜深了')
  if (h < 11) return t('早上好')
  if (h < 13) return t('中午好')
  if (h < 18) return t('下午好')
  return t('晚上好')
}
