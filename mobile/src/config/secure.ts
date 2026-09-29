import * as SecureStore from 'expo-secure-store'

// 原生端：hub 地址、令牌存 Android Keystore 支撑的 expo-secure-store。
export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
}
