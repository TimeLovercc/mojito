import { HubError, ReadableError } from './api/client'
import { t } from './i18n'
import { trackAction } from './usage'

// 报错给人看的一句话 + 点开才看的细节（docs/api.md"兼容规则"：不把原始 JSON 给用户看）
export type HumanError = { message: string; detail: string }

const PICKER_BROKEN = /unregistered ActivityResultLauncher/

export function humanize(err: Error): HumanError {
  const detail = err.message
  if (err instanceof HubError) {
    const byStatus: Record<number, string> = {
      401: t('令牌不对，去"系统"页检查 app 令牌'),
      403: t('这个令牌没有权限做这件事'),
      404: t('找不到了，可能已被删除'),
      409: t('和现在的状态冲突（可能别处已经改过），刷新一下再试'),
      413: t('内容太大，服务器不收'),
      422: t('服务器暂时不接受这个请求（app 或 hub 需要更新），已记下'),
    }
    if (err.status in byStatus) return { message: byStatus[err.status], detail }
    if (err.status >= 500) return { message: t('hub 出错了，稍后再试'), detail }
    return { message: t('hub 返回 {status}', { status: err.status }), detail }
  }
  // expo/expo#50386：系统设置变化（字体大小、显示大小、语言）后 Activity 被重建，选图启动器失效到进程重启
  if (PICKER_BROKEN.test(detail)) return { message: t('系统设置变化后选图暂时失效：从最近任务里划掉 Mojito 再打开即可'), detail }
  // 连不上、超时等 app 自己写的人话（ReadableError，或中文）原样用
  if (err instanceof ReadableError || /[一-鿿]/.test(detail)) return { message: detail, detail }
  return { message: t('出错了'), detail }
}

// 上报一条 client_error 使用记录：detail 只放路径和状态码，不放内容
export function reportError(err: Error) {
  if (err instanceof HubError) trackAction('client_error', { path: err.path.split('?')[0], status: String(err.status) })
  else trackAction('client_error', { path: 'local', status: PICKER_BROKEN.test(err.message) ? 'picker_unregistered' : 'other' })
}
