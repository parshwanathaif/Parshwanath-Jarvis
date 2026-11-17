"""Configuration and persistent state (plain JSON files, no database)."""
import json
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULTS = {
    "user_name": "Sir",
    "assistant_name": "Jarvis",
    "city": "Mumbai",
    "language": "en-IN",
    "news_region": "IN",
    "preferred_exchanges": [".NS", ".BO"],
    "ticker": ["^NSEI", "^BSESN", "^NSEBANK", "USDINR=X", "GC=F", "CL=F"],
    "alert_check_seconds": 60,
    "ai_model": "claude-opus-5-5",
    "share_portfolio_with_ai": True,
    "email": {"smtp_host": "smtp.gmail.com", "smtp_port": 587, "address": ""},
    "contacts": {},
    "prefer_desktop_apps": True,
    "business_apps": ["gmail", "whatsapp", "google calendar"],
    "connections": {},
}


def load_env(path=None):
    """Read KEY=VALUE lines from .env into the environment (existing vars win)."""
    path = path or os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config(path=None):
    cfg = json.loads(json.dumps(DEFAULTS))
    path = path or os.path.join(ROOT, "config.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            user = json.load(f)
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


class Store:
    """Thread-safe JSON state: notes, to-dos, portfolio, watchlist, alerts."""

    EMPTY = {"notes": [], "todos": [], "portfolio": {}, "watchlist": [], "alerts": [],
             "realised": [], "symbols": {}}

    def __init__(self, path=None):
        self.path = path or os.path.join(ROOT, "data", "state.json")
        self.lock = threading.RLock()
        self.data = json.loads(json.dumps(self.EMPTY))
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))

    def save(self):
        with self.lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)

    def __getitem__(self, key):
        return self.data[key]

    def __setitem__(self, key, value):
        self.data[key] = value
