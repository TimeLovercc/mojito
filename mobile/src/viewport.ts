// 软键盘是否弹出（网页版见 viewport.web.ts）。原生端由 KeyboardAvoidingView / 系统处理，这里永远是 false
export function useKeyboardOpen(): boolean {
  return false
}
