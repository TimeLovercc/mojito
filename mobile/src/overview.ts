import { t } from './i18n'
import { tauri } from './tauri'

// Mac app 里用系统默认程序打开本地路径（研究卡片论文一行的 PDF、评审、文件夹）；desktop 外壳的 open_path 命令
export function openPath(path: string): Promise<void> {
  if (tauri === null) return Promise.reject(new Error(t('只有 Mac app 能打开本地文件')))
  return tauri.core.invoke<void>('open_path', { path }).catch((err: string) => {
    throw new Error(err)
  })
}
