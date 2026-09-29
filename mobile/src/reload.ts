import * as Updates from 'expo-updates'

// 字号、深浅色在样式创建时就定下，改了之后重载一次 JS 生效
export function reloadApp(): Promise<void> {
  return Updates.reloadAsync()
}
