"""Conversation basics: greetings, time, jokes, notes, to-dos, system status."""
import datetime as dt
import os
import random
import re
import shutil

from ..core import Reply

JOKES = [
    "Why did the investor bring a ladder to the exchange? Because the market was going through the roof.",
    "I asked the market for a sign. It gave me a candlestick.",
    "My portfolio and I have a lot in common. We both need more green.",
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "There are 10 kinds of people: those who understand binary and those who do not.",
    "A bull, a bear and an analyst walk into a bar. Only the analyst predicted it afterwards.",
]

HELP = [
    ["Markets", "market update · price of Reliance · how is TCS doing · chart of Infosys · fundamentals of ITC"],
    ["Portfolio", "I bought 10 shares of Reliance at 2900 · sold 5 TCS at 4100 · how is my portfolio · top gainers · realised profit · import portfolio"],
    ["Watchlist & alerts", "add Cipla to my watchlist · show watchlist · alert me when Nifty goes above 26000 · show alerts"],
    ["Calculators", "SIP of 10,000 a month for 15 years at 12 percent · lump sum of 5 lakh for 10 years · CAGR from 100 to 250 in 5 years · convert 500 dollars to rupees"],
    ["Information", "news · news about pharma sector · weather in Mumbai · who is Warren Buffett · meaning of arbitrage"],
    ["Web & apps", "open YouTube · open Zerodha · search for best ELSS funds · play lofi on YouTube · show Nariman Point on map"],
    ["Memory", "remember that the AGM is on Friday · what do you remember · add call the auditor to my to-do list · show my to-do list"],
    ["Email", "send email to Rahul saying the report is ready"],
    ["Assistant", "what time is it · tell me a joke · switch to Friday · system status · go to sleep"],
]


def greet(j, m=None):
    hour = dt.datetime.now().hour
    part = "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"
    return Reply(f"{part} {j.cfg['user_name']}. {j.cfg['assistant_name']} at your service. How may I help?")


def time_now(j, m):
    return Reply("The time is " + dt.datetime.now().strftime("%I:%M %p").lstrip("0") + ".")


def date_today(j, m):
    return Reply("Today is " + dt.datetime.now().strftime("%A, %d %B %Y") + ".")


def identity(j, m):
    return Reply(f"I am {j.cfg['assistant_name']}, Just A Rather Very Intelligent System. I run your investing desk, "
                 "watch the markets, and handle the web, notes and email by voice.")


def show_help(j, m):
    return Reply("Here is what I can do. Markets and portfolio, watchlist and alerts, calculators, news, weather, "
                 "web search, notes, to-dos and email. The list is on screen.",
                 {"title": "Voice commands", "columns": ["Area", "Try saying"], "rows": HELP})


def voice(j, m):
    female = bool(re.search(r"friday|female|lady|woman", m.group(0), re.I))
    name = "Friday" if female else "Jarvis"
    return Reply(f"{name} online.", voice="female" if female else "male")


def sleep(j, m):
    return Reply(f"Going quiet. Say '{j.cfg['assistant_name']}' or press the microphone when you need me.", sleep=True)


def thanks(j, m):
    return Reply(f"Always a pleasure, {j.cfg['user_name']}.")


def system_status(j, m):
    total, used, free = shutil.disk_usage(os.path.expanduser("~"))
    parts = [f"Disk is {used / total * 100:.0f} percent used with {free / 1e9:.0f} gigabytes free."]
    try:
        import psutil
        parts.insert(0, f"CPU is at {psutil.cpu_percent(interval=0.3):.0f} percent and memory at "
                        f"{psutil.virtual_memory().percent:.0f} percent.")
        bat = psutil.sensors_battery()
        if bat:
            parts.append(f"Battery is at {bat.percent:.0f} percent{', charging' if bat.power_plugged else ''}.")
    except Exception:
        if hasattr(os, "getloadavg"):
            parts.insert(0, f"System load is {os.getloadavg()[0]:.2f} across {os.cpu_count()} cores.")
    return Reply(" ".join(parts))


# -- memory ----------------------------------------------------------------
def remember(j, m):
    note = m.group("note").strip()
    with j.store.lock:
        j.store["notes"].append({"text": note, "when": dt.datetime.now().strftime("%d %b %Y %H:%M")})
        j.store.save()
    return Reply(f"I will remember that {note}.")


def recall(j, m):
    notes = j.store["notes"]
    if not notes:
        return Reply("You have not asked me to remember anything yet.")
    return Reply("You asked me to remember: " + ". ".join(n["text"] for n in notes[-5:]) + ".",
                 {"title": "Notes", "columns": ["When", "Note"], "rows": [[n["when"], n["text"]] for n in notes]})


def forget(j, m):
    with j.store.lock:
        j.store["notes"] = []
        j.store.save()
    return Reply("All notes cleared.")


def todo_add(j, m):
    with j.store.lock:
        j.store["todos"].append(m.group("task").strip())
        j.store.save()
    return Reply(f"Added to your to-do list: {m.group('task').strip()}.")


def todo_show(j, m):
    todos = j.store["todos"]
    if not todos:
        return Reply("Your to-do list is empty.")
    return Reply(f"You have {len(todos)} tasks. " + ". ".join(f"{i}, {t}" for i, t in enumerate(todos[:6], 1)) + ".",
                 {"title": "To-do list", "columns": ["#", "Task"], "rows": [[i, t] for i, t in enumerate(todos, 1)]})


def todo_done(j, m):
    n = int(m.group("n"))
    with j.store.lock:
        todos = j.store["todos"]
        if not 1 <= n <= len(todos):
            return Reply(f"There is no task number {n}.")
        task = todos.pop(n - 1)
        j.store.save()
    return Reply(f"Done. Removed: {task}.")


def todo_clear(j, m):
    with j.store.lock:
        j.store["todos"] = []
        j.store.save()
    return Reply("To-do list cleared.")


def register(j):
    todo = r"(?:to ?do|to-do|task)s?(?: list)?"
    j.on(r"^(hi|hello|hey|namaste|good (morning|afternoon|evening)|are you there|wake up|you there)\b", greet)
    j.on(r"\b(thank you|thanks|well done|good job)\b", thanks)
    j.on(r"^(help|commands)$|what can you do|what are your (features|skills|commands)", show_help)
    j.on(r"\b(switch|change) to (friday|jarvis)\b|\b(female|male|lady|man'?s?) voice\b", voice)
    j.on(r"^(go to sleep|sleep|stop listening|goodbye|good night|bye|that'?s all|quit|exit)\b", sleep)
    j.on(r"\bremember (?:that )?(?P<note>.+)", remember)
    j.on(r"\b(what do you remember|do you remember anything|my notes|show notes|what did i (tell|ask) you)\b", recall)
    j.on(r"\b(forget everything|clear (my )?(notes|memory))\b", forget)
    j.on(rf"\badd (?P<task>.+?) (?:to|in|on) (?:my |the )?{todo}$", todo_add)
    j.on(rf"\b(?:clear|empty) (?:my |the )?{todo}", todo_clear)
    j.on(rf"\b(?:remove|delete|done|complete|finish(?:ed)?) (?:with )?(?:task |item |number )*(?P<n>\d+)", todo_done)
    j.on(rf"\b{todo}\b|\bmy tasks\b", todo_show)
    j.on(r"\b(what(?:'s| is) the time|time is it|current time|the time)\b", time_now)
    j.on(r"\b(what(?:'s| is) (the|today'?s) date|what day is it|today'?s date)\b", date_today)
    j.on(r"\b(who are you|your name|who (made|created|built) you|what does jarvis stand for|stands? for)\b", identity)
    j.on(r"\bjoke\b|make me laugh", lambda j, m: Reply(random.choice(JOKES)))
    j.on(r"\b(cpu|battery|system (status|health)|memory usage|disk space)\b", system_status)
