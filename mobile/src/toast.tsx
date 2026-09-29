import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { humanize, reportError } from './errors'
import { colors, font, radii, size } from './theme'
import { t } from './i18n'

// 网页端没有 Alert，所有动作结果都用这个提示条。
// 报错只显示一句人话；有细节（原始报错）时可以点开看，点开后不自动消失，再点收起并关掉。
type Toast = { text: string; error: boolean; detail: string | null; shownAt: number }
type ToastApi = { show: (text: string, error: boolean) => void; showError: (prefix: string, err: Error) => void }
const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(false)
  // 布局动画（entering/exiting）在网页端会卡在 visibility:hidden，用共享值做淡入淡出。
  // 动画要在渲染提交之后再启动，否则网页端的重渲染会把样式盖回初始值。
  const opacity = useSharedValue(0)
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: (1 - opacity.value) * 12 }] }))

  const show = useCallback((text: string, error: boolean) => {
    setExpanded(false)
    setToast({ text, error, detail: null, shownAt: Date.now() })
  }, [])
  const showError = useCallback((prefix: string, err: Error) => {
    const h = humanize(err)
    reportError(err)
    setExpanded(false)
    setToast({ text: t('{prefix}：{message}', { prefix, message: h.message }), error: true, detail: h.detail === h.message ? null : h.detail, shownAt: Date.now() })
  }, [])

  const hide = useCallback(() => {
    opacity.value = withTiming(0, { duration: 180 })
    setVisible(false)
  }, [opacity])

  useEffect(() => {
    if (toast === null) return
    opacity.value = withTiming(1, { duration: 180 })
    setVisible(true)
    if (expanded) return
    const timer = setTimeout(hide, toast.error ? 6000 : 2500)
    return () => clearTimeout(timer)
  }, [toast, expanded, opacity, hide])

  const detail = toast === null ? null : toast.detail
  return (
    <ToastContext.Provider value={{ show, showError }}>
      {children}
      {/* 一直挂着，只改内容和透明度：新挂载的视图在网页端收不到同一帧开始的动画 */}
      <Animated.View
        style={[styles.toast, toast !== null && toast.error && styles.error, fade]}
        pointerEvents={visible && detail !== null ? 'auto' : 'none'}
      >
        <Pressable
          disabled={detail === null}
          onPress={() => {
            if (expanded) hide()
            setExpanded(!expanded)
          }}
        >
          <Text style={styles.text}>{toast === null ? '' : toast.text}</Text>
          {detail === null ? null : expanded ? (
            <Text style={styles.detail} selectable>
              {detail}
              {'\n'}
              {t('（点一下关掉）')}
            </Text>
          ) : (
            <Text style={styles.more}>{t('点开看细节')}</Text>
          )}
        </Pressable>
      </Animated.View>
    </ToastContext.Provider>
  )
}

function useToastApi(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast 必须在 ToastProvider 内使用')
  return api
}

// 普通提示（成功、提醒）
export function useToast() {
  return useToastApi().show
}

// 报错：一句人话 + 点开看细节，并上报 client_error
export function useErrorToast() {
  return useToastApi().showError
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 136,
    backgroundColor: colors.raised,
    borderRadius: radii.card,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  error: { borderColor: colors.bad },
  text: { ...font.regular, color: colors.tx, fontSize: size.body },
  more: { ...font.regular, color: colors.tx2, fontSize: size.small, marginTop: 4 },
  detail: { ...font.mono, color: colors.tx2, fontSize: size.small, marginTop: 6 },
})
