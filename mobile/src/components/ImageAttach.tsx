import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Camera, Image as ImageIcon, X } from 'lucide-react-native'
import { uploadImage } from '../api/upload'
import type { HubConfig } from '../config/store'
import { HAS_CAMERA, MAX_IMAGES, pickImages, type PreparedImage } from '../images'
import { useErrorToast } from '../toast'
import { colors, desktop, font, size } from '../theme'
import { t } from '../i18n'

// 输入框旁的"图片"：一个按钮（手机上点开选拍照还是相册，电脑上直接打开文件选择）、待发的缩略图、上传。
// 对话输入框和笔记输入框共用（design.md 8.3、8.6）
export function useImageAttach(busy: boolean) {
  const showError = useErrorToast()
  const [images, setImages] = useState<PreparedImage[]>([])
  const [choosing, setChoosing] = useState(false)
  const full = images.length >= MAX_IMAGES

  const pick = async (source: 'library' | 'camera') => {
    setChoosing(false)
    try {
      const picked = await pickImages(source, MAX_IMAGES - images.length)
      setImages((prev) => [...prev, ...picked])
    } catch (err) {
      if (!(err instanceof Error)) throw err
      showError(t('没取到图片'), err)
    }
  }

  // 逐张 POST /attachments，返回附件 id
  const upload = async (hub: HubConfig): Promise<string[]> => {
    const ids: string[] = []
    for (const img of images) ids.push((await uploadImage(hub, img.uri)).id)
    return ids
  }

  const pending =
    images.length === 0 ? null : (
      <View style={styles.pending}>
        {images.map((img, i) => (
          <View key={img.uri}>
            <Image source={{ uri: img.uri }} style={styles.pendingThumb} />
            <Pressable
              accessibilityLabel={t('去掉这张')}
              hitSlop={6}
              style={styles.remove}
              disabled={busy}
              onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))}
            >
              <X size={12} color={colors.tx} />
            </Pressable>
          </View>
        ))}
      </View>
    )

  const chooser = choosing ? (
    <View style={styles.choose}>
      <Pressable style={styles.chooseBtn} onPress={() => pick('camera')}>
        <Camera size={15} color={colors.tx} />
        <Text style={styles.chooseText}>{t('拍照')}</Text>
      </Pressable>
      <Pressable style={styles.chooseBtn} onPress={() => pick('library')}>
        <ImageIcon size={15} color={colors.tx} />
        <Text style={styles.chooseText}>{t('从相册选')}</Text>
      </Pressable>
    </View>
  ) : null

  const button = (
    <Pressable
      accessibilityLabel={t('图片')}
      hitSlop={4}
      disabled={busy || full}
      onPress={() => (HAS_CAMERA ? setChoosing(!choosing) : pick('library'))}
      style={[styles.tool, (busy || full) && { opacity: 0.35 }]}
    >
      <ImageIcon size={18} color={choosing ? colors.brand : colors.tx2} />
    </Pressable>
  )

  return { count: images.length, clear: () => setImages([]), upload, pending, chooser, button }
}

const styles = StyleSheet.create({
  pending: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 8 },
  pendingThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.raised },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 电脑：32 见方、圆角 8（docs/desktop-v2.md 控件）
  tool: desktop
    ? { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }
    : { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  choose: { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginBottom: 8 },
  chooseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chooseText: { ...font.regular, fontSize: size.secondary, color: colors.tx },
})
