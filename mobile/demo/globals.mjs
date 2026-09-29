// Injected into the mock bundle (esbuild `inject`): Node globals the mock reads.
import { Buffer } from './buffer.mjs'

const demo = () => globalThis.__mojitoDemo

export { Buffer }

export const process = {
  get env() {
    return {
      MOCK_TOKEN: demo().token,
      PORT: '1',
      MOCK_LANGUAGE: demo().language,
      EXPO_PUBLIC_MOJITO_TIMEZONE: demo().timezone,
    }
  },
  loadEnvFile() {},
}

const browserSetInterval = globalThis.setInterval
export function setInterval(fn, ms) {
  const id = browserSetInterval(fn, ms)
  demo().timers.push(id)
  return { unref() {} }
}
