import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadConfig, saveConfig, type AppConfig } from './store'
import { clearCache, dropOldCache } from '../cache'
import { clearMemory } from '../use-hub'
import { PwaGate } from '../components/PwaGate'

type ConfigState = { config: AppConfig; update: (next: AppConfig) => Promise<void> }

const ConfigContext = createContext<ConfigState | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    dropOldCache().then(loadConfig).then(setConfig)
  }, [])

  const update = useCallback(
    async (next: AppConfig) => {
      await saveConfig(next)
      // 换了 hub，旧缓存不属于新 hub
      if (config === null || JSON.stringify(config.hub) !== JSON.stringify(next.hub)) {
        await clearCache()
        clearMemory()
      }
      setConfig(next)
    },
    [config],
  )

  if (config === null) return null
  // 网页版（PWA）没令牌时先走安装引导；原生端和 Mac 直接显示（src/components/PwaGate*.tsx）
  return (
    <ConfigContext.Provider value={{ config, update }}>
      <PwaGate>{children}</PwaGate>
    </ConfigContext.Provider>
  )
}

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext)
  if (ctx === null) throw new Error('useConfig 必须在 ConfigProvider 内使用')
  return ctx
}
