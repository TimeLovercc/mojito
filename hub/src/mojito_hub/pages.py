"""Public, token-free static pages required for Google OAuth publishing (api.md 公开页面).
Plain HTML, no external resources, no data. Who runs the instance and how to reach them come from
MOJITO_OWNER_NAME / MOJITO_CONTACT_EMAIL (config)."""
from html import escape

from . import config

_STYLE = ("body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;"
          "line-height:1.6;color:#222}h1{font-size:1.5rem}a{color:#0b57d0}")

_OWNER = escape(config.OWNER_NAME)
_EMAIL = escape(config.CONTACT_EMAIL)
_CONTACT = f'<a href="mailto:{_EMAIL}">{_EMAIL}</a>'


def _page(title: str, body: str) -> str:
    return (f'<!doctype html><html><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{title}</title><style>{_STYLE}</style></head><body>{body}</body></html>")


HOME = _page("Mojito", f"""
<h1>Mojito</h1>
<p>这是一个自托管的 Mojito 实例，由 {_OWNER} 运行，只供其本人使用，不对外提供服务。联系：{_CONTACT}</p>
<p>This is a self-hosted Mojito instance run by {_OWNER} for their own use. It does not offer any service to the public. Contact: {_CONTACT}</p>
<p><a href="/privacy">隐私说明 / Privacy Policy</a></p>
""")

PRIVACY = _page("Mojito · Privacy Policy", f"""
<h1>隐私说明 / Privacy Policy</h1>
<p>这个 Mojito 实例只有 {_OWNER} 一人使用。它读取其 Google Calendar（并只读写 Mojito 自己创建的事件）和 Gmail（只读），唯一目的是给本人显示和整理这些信息。数据存放在运行者自己的服务器上，不出售、不与任何人共享、不用于广告。app 里的 agent 会把它读到的内容发给所用的模型提供方（Anthropic 的 Claude）处理。可随时在 <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> 撤销授权。</p>
<p>This Mojito instance is used only by {_OWNER}. It reads their Google Calendar (creating and changing only events that Mojito itself created, and deleting an event only when its owner asks) and Gmail (read-only) solely to show and organize this information for them. Data is stored on the operator's own server and is never sold, shared with anyone, or used for advertising. The app's agents send what they read to the model provider in use (Anthropic's Claude) for processing. Access can be revoked at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
<p>联系 / Contact: {_CONTACT}</p>
""")
