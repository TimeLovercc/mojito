// 当前运行的 JS 包（原生端见 bundle.ts）：expo export -p web 的入口脚本文件名带内容哈希
// （/_expo/static/js/web/index-<hash>.js），Mac app 和网页版（PWA）都用它；expo start --web 的开发包没有哈希，按这次加载算一个新包
const ENTRY = /\/_expo\/static\/js\/web\/[\w-]+-([0-9a-f]{16,})\.js$/
const entry = Array.from(document.querySelectorAll('script[src]'))
  .map((s) => new URL((s as HTMLScriptElement).src).pathname.match(ENTRY))
  .find((m) => m !== null)
const loadedAt = Date.now()
export const bundleId: string = entry === undefined ? `dev-${loadedAt}` : entry[1]
