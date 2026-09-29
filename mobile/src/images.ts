import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { ReadableError } from './api/client'
import { t } from './i18n'

// 对话发图（docs/api.md"对话发图片"）：长边 ≤ 1600、JPEG 质量 0.8；重新编码后不带 EXIF（包括定位）
export const MAX_IMAGES = 4
// 手机上"图片"按钮先选拍照还是相册；网页端（images.web.ts）直接打开文件选择
export const HAS_CAMERA = true
const MAX_EDGE = 1600

export type PreparedImage = { uri: string; width: number; height: number }

async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<PreparedImage> {
  const long = Math.max(asset.width, asset.height)
  const ctx = ImageManipulator.manipulate(asset.uri)
  if (long > MAX_EDGE) ctx.resize(asset.width >= asset.height ? { width: MAX_EDGE, height: null } : { width: null, height: MAX_EDGE })
  const ref = await ctx.renderAsync()
  const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG })
  return { uri: out.uri, width: out.width, height: out.height }
}

// 从相册选（可多选，最多 remaining 张）或拍一张；用户取消返回空列表
export async function pickImages(source: 'library' | 'camera', remaining: number): Promise<PreparedImage[]> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false }
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new ReadableError(t('没有相机权限，去系统设置里给 Mojito 打开'))
    result = await ImagePicker.launchCameraAsync(options)
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: remaining })
  }
  if (result.canceled) return []
  return Promise.all(result.assets.slice(0, remaining).map(prepare))
}
