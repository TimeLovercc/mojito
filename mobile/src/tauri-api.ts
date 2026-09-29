// desktop 会话提供的 Tauri 全局 API（withGlobalTauri，见 desktop/README.md）；mobile 只用到这些
export type TauriApi = {
  core: { invoke: <T>(cmd: string, args: Record<string, unknown>) => Promise<T> }
  event: { listen: <P>(name: string, handler: (e: { payload: P }) => void) => Promise<() => void> }
  // 官方 autostart 插件
  autostart: { isEnabled: () => Promise<boolean>; enable: () => Promise<void>; disable: () => Promise<void> }
}

// Rust 每 30 秒拉 /pulse 后发给所有窗口
export type PulsePayload = { due_today: number; needs_you: number; new_records: number }
