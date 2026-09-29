"""/app/: the PWA build served from MOJITO_WEB_DIR (api.md 公开静态路径). No token.

MOJITO_WEB_DIR is a symlink (…/current); StaticFiles resolves it per request, so switching
releases takes effect without a restart."""

import mimetypes
import os

from starlette.exceptions import HTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Scope

from . import config

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; "
       "font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; "
       "form-action 'none'; frame-ancestors 'none'; object-src 'none'")
IMMUTABLE_PREFIX = "_expo/static/"
GZIP_MIN_BYTES = 1024


class WebApp(StaticFiles):
    """Existing file → as is; missing path without extension → index.html (client routing);
    missing file with extension, or a path escaping the directory → 404. Every response gets
    the cache, CSP and Referrer-Policy headers."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path == ".." or path.startswith(("../", "..\\")):
            response: Response = PlainTextResponse("Not Found", status_code=404)
        else:
            try:
                response = await super().get_response(path, scope)
            except HTTPException as e:
                has_extension = os.path.splitext(path.rsplit("/", 1)[-1])[1] != ""
                if e.status_code != 404:
                    response = PlainTextResponse(e.detail, status_code=e.status_code)  # e.g. 405
                elif has_extension:
                    response = PlainTextResponse("Not Found", status_code=404)
                else:
                    path = "index.html"
                    response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable" if path.startswith(IMMUTABLE_PREFIX) else "no-cache")
        response.headers["Content-Security-Policy"] = CSP
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


def app() -> ASGIApp:
    """The ASGI app to mount at /app: gzip applies to these responses only."""
    return GZipMiddleware(WebApp(directory=config.WEB_DIR, html=True), minimum_size=GZIP_MIN_BYTES)
