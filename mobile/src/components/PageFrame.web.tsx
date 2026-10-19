// 页面显示（docs/api.md「页面 · 显示」）：iframe 加载 hub 的签名链接，占满内容区。
// sandbox 和 hub 响应头的 CSP 一致：能跑脚本、能开新窗口，不给 allow-same-origin，页面脚本拿不到 app 和 hub 的任何东西
export function PageFrame({ url, title }: { url: string; title: string }) {
  return (
    <iframe
      key={url}
      src={url}
      title={title}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', display: 'block', background: 'transparent' }}
    />
  )
}
