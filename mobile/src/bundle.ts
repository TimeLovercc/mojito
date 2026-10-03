import * as Updates from 'expo-updates'

// 当前运行的 JS 包（网页端见 bundle.web.ts）：APK 内置包和空中更新都有 updateId；开发模式没有，按这次加载算一个新包
const loadedAt = Date.now()
export const bundleId: string = Updates.updateId === null ? `dev-${loadedAt}` : Updates.updateId
