// 安卓不在 app 里显示页面：点开用系统浏览器（src/pages.ts useOpenPage），不进页面显示页。
// 以后要 app 内显示得加 webview、重装 APK（docs/api.md「页面 · 显示」），到时再问用户
export function PageFrame({ url }: { url: string; title: string }): never {
  throw new Error(`安卓上页面用系统浏览器打开，不该渲染 iframe：${url}`)
}
