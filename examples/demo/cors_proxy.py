"""CORS front for a local hub, only for Expo web mode during development (npm run web): the hub sends no
CORS headers (in production the web app is served by the hub itself at /app, same origin, no CORS needed).
  python3 cors_proxy.py <listen-port> <hub-port>  -> hub address in the app: http://localhost:<listen-port>,
app token as usual. Binds 127.0.0.1 only."""
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN, HUB = int(sys.argv[1]), f"http://127.0.0.1:{int(sys.argv[2])}"
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS"}
PASS = ("Authorization", "Content-Type")


class Proxy(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def forward(self):
        length = int(self.headers["Content-Length"]) if "Content-Length" in self.headers else 0
        body = self.rfile.read(length) if length else None
        headers = {k: self.headers[k] for k in PASS if k in self.headers}
        req = urllib.request.Request(HUB + self.path, data=body, method=self.command, headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:  # hub errors pass through unchanged
            resp = e
        data = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers["Content-Type"])
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = forward


ThreadingHTTPServer(("127.0.0.1", LISTEN), Proxy).serve_forever()
