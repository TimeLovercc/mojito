import { ReadableError } from './api/client'
import { t } from './i18n'

// 网页 / Mac app：用网页文件选择选图，canvas 缩到长边 ≤ 1600、重新编码为 JPEG 0.8（不带 EXIF），得到 blob: uri。
// 电脑上没有拍照，"图片"按钮直接打开文件选择（HAS_CAMERA = false）。
// 逐张串行处理：iPhone 上 4 张 24MP 原图同时解码会把内存撑爆（design.md 8.8），串行时峰值只有一张。
export const MAX_IMAGES = 4
const MAX_EDGE = 1600
export const HAS_CAMERA = false

export type PreparedImage = { uri: string; width: number; height: number }

async function prepare(file: File): Promise<PreparedImage> {
  // 按 EXIF 方向摆正（竖拍的照片）
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new ReadableError(t('浏览器不支持 canvas 2d'))
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b === null ? reject(new ReadableError(t('图片转 JPEG 失败：{name}', { name: file.name }))) : resolve(b)), 'image/jpeg', 0.8),
  )
  return { uri: URL.createObjectURL(blob), width, height }
}

async function prepareAll(files: File[]): Promise<PreparedImage[]> {
  const out: PreparedImage[] = []
  for (const file of files) out.push(await prepare(file))
  return out
}

// 打开文件选择（可多选，最多 remaining 张）；用户取消返回空列表
export function pickImages(source: 'library' | 'camera', remaining: number): Promise<PreparedImage[]> {
  if (source === 'camera') throw new ReadableError(t('电脑上不能拍照'))
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.addEventListener('change', () => {
      if (input.files === null) return resolve([])
      prepareAll([...input.files].slice(0, remaining)).then(resolve, reject)
    })
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}
