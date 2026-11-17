#!/usr/bin/env python3
"""J.A.R.V.I.S - voice assistant with an investing desk.

    python jarvis.py            open the voice HUD in your browser (recommended)
    python jarvis.py --text     type commands in the terminal
    python jarvis.py --voice    microphone + speaker in the terminal (extra packages)
"""
import argparse
import os
import subprocess
import sys
import threading
import webbrowser

from jarvis.config import load_config, load_env
from jarvis.core import Jarvis
from jarvis.skills import portfolio


def print_reply(reply):
    print(f"Jarvis: {reply['speech']}")
    panel = reply.get("panel")
    if panel:
        for row in panel["rows"]:
            print("   " + "  |  ".join(str(c["text"] if isinstance(c, dict) else c) for c in row))


def open_hud(url):
    """Open the HUD in its own Chrome/Edge app window on Windows, so the sites Jarvis opens
    go to your normal browser window and Jarvis keeps listening. Falls back to a normal tab."""
    if sys.platform == "win32":
        roots = [os.environ.get(k, "") for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
        for rel in (r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe"):
            for root in roots:
                exe = os.path.join(root, rel)
                if root and os.path.exists(exe):
                    subprocess.Popen([exe, f"--app={url}", "--window-size=1200,860"])
                    return
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description="Jarvis voice assistant")
    parser.add_argument("--text", action="store_true", help="type commands in the terminal")
    parser.add_argument("--voice", action="store_true", help="terminal microphone mode")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open the HUD automatically")
    parser.add_argument("command", nargs="*", help="run one command and exit")
    args = parser.parse_args()

    load_env()
    j = Jarvis(load_config())
    if not j.store["portfolio"]:
        portfolio.import_csv(j)

    if args.command:
        print_reply(j.handle(" ".join(args.command)))
        return
    portfolio.start_alert_thread(j)
    if args.voice:
        from jarvis import voice
        return voice.run(j)
    if args.text:
        print("Jarvis text mode. Type a command, or 'exit' to quit.")
        while True:
            try:
                text = input("You: ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            while not j.notifications.empty():
                print("Jarvis:", j.notifications.get())
            if text.lower() in ("exit", "quit"):
                break
            if text:
                print_reply(j.handle(text))
        return

    from jarvis.server import serve
    try:
        httpd = serve(j, args.port)
    except OSError:
        sys.exit(f"Port {args.port} is busy. Jarvis may already be running, or try: python jarvis.py --port 8766")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Jarvis is online at {url}\nUse Chrome or Edge for voice. Press Ctrl+C here to shut down.")
    if not args.no_browser:
        threading.Timer(0.6, open_hud, [url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nJarvis offline.")


if __name__ == "__main__":
    main()
