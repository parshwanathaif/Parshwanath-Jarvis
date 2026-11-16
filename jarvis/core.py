"""The brain: turns a sentence into an action by matching it against skills."""
import os
import queue
import re
import subprocess
import sys
import webbrowser

from .config import Store, load_config


class Reply:
    def __init__(self, speech, panel=None, **extra):
        self.speech = speech
        self.panel = panel  # {"title": str, "columns": [...], "rows": [[...]]}
        self.extra = extra

    def to_dict(self):
        return {"speech": self.speech, "panel": self.panel, **self.extra}


class Jarvis:
    def __init__(self, cfg=None, store=None):
        self.cfg = cfg or load_config()
        self.store = store or Store()
        self.routes = []
        self.notifications = queue.Queue()
        self.opened = []  # record of launched targets (also used by tests)
        from .skills import ALL
        for module in ALL:
            module.register(self)

    # -- registration -------------------------------------------------
    def on(self, pattern, handler):
        self.routes.append((re.compile(pattern, re.I), handler))

    # -- side effects -------------------------------------------------
    def open_url(self, url):
        self.opened.append(url)
        if not os.environ.get("JARVIS_NO_BROWSER"):
            webbrowser.open(url)

    def open_app(self, target):
        self.opened.append(target)
        if os.environ.get("JARVIS_NO_BROWSER"):
            return
        if sys.platform == "win32":
            os.startfile(target)  # noqa: S606 - user-configured target
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-a", target])
        else:
            subprocess.Popen(target.split())

    def notify(self, message):
        self.notifications.put(message)

    # -- main entry ---------------------------------------------------
    def clean(self, text):
        text = " ".join(str(text).strip().split())
        name = re.escape(self.cfg["assistant_name"])
        text = re.sub(rf"^(hey|ok|okay|hi|hello)?\s*{name}\b[\s,.!]*", "", text, flags=re.I)
        return text.strip(" .!?,")

    def handle(self, text):
        query = self.clean(text)
        if not query:
            return Reply(f"Yes {self.cfg['user_name']}?").to_dict()
        for pattern, handler in self.routes:
            m = pattern.search(query)
            if not m:
                continue
            try:
                out = handler(self, m)
            except OSError as e:
                out = Reply(f"I could not reach the internet service for that. {type(e).__name__}: {e}")
            except Exception as e:  # keep the assistant alive whatever a skill does
                out = Reply(f"Something went wrong while doing that: {e}")
            if out is None:
                continue  # skill declined; try the next route
            if isinstance(out, str):
                out = Reply(out)
            return out.to_dict()
        return Reply("I did not understand that. Say 'help' to hear what I can do.").to_dict()
