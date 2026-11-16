"""Local web server: serves the HUD and the command API on 127.0.0.1 only."""
import json
import os
import queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .skills import ai, market, portfolio

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def dashboard(j):
    symbols = list(j.cfg["ticker"]) + list(j.store["watchlist"])
    qs = market.quotes(symbols)

    def rows(keys):
        return [{"name": qs[s]["name"], "price": market.price_text(qs[s]), "pct": qs[s]["pct"]} for s in keys if s in qs]

    snap = portfolio.snapshot(j)
    return {"ticker": rows(j.cfg["ticker"]), "watchlist": rows(j.store["watchlist"]),
            "portfolio": portfolio.panel(snap) if snap["rows"] else None,
            "alerts": len(j.store["alerts"]), "ai": ai.available(),
            "user": j.cfg["user_name"], "assistant": j.cfg["assistant_name"], "language": j.cfg["language"]}


def make_handler(j):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Jarvis"

        def log_message(self, *args):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _local(self):
            """Reject requests made by other websites or other machines."""
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost") and self.headers.get("X-Jarvis") == "1"

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                with open(os.path.join(WEB, "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html")
            if not self._local():
                return self._send(403, {"error": "forbidden"})
            if path == "/api/dashboard":
                try:
                    return self._send(200, dashboard(j))
                except Exception as e:
                    return self._send(200, {"error": str(e)})
            if path == "/api/poll":
                items = []
                while True:
                    try:
                        items.append(j.notifications.get_nowait())
                    except queue.Empty:
                        break
                return self._send(200, {"notifications": items})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/api/command" or not self._local():
                return self._send(403, {"error": "forbidden"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                text = json.loads(self.rfile.read(min(length, 20000)) or b"{}").get("text", "")
            except (ValueError, AttributeError):
                return self._send(400, {"error": "bad request"})
            self._send(200, j.handle(text))

    return Handler


def serve(j, port=8765):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(j))
    httpd.daemon_threads = True
    return httpd
