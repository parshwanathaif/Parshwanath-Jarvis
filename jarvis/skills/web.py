"""Web skills: custom connections, sites, search, news, weather, Wikipedia, dictionary, email."""
import os
import re
import smtplib
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from email.message import EmailMessage

from ..core import Reply
from ..util import get_json, http_get, post_json

SITES = {
    "youtube": "https://www.youtube.com", "google": "https://www.google.com", "gmail": "https://mail.google.com",
    "mail": "https://mail.google.com", "calendar": "https://calendar.google.com", "drive": "https://drive.google.com",
    "maps": "https://maps.google.com", "github": "https://github.com", "amazon": "https://www.amazon.in",
    "stack overflow": "https://stackoverflow.com", "stackoverflow": "https://stackoverflow.com",
    "whatsapp": "https://web.whatsapp.com", "linkedin": "https://www.linkedin.com", "twitter": "https://x.com",
    "zerodha": "https://kite.zerodha.com", "kite": "https://kite.zerodha.com", "groww": "https://groww.in",
    "upstox": "https://pro.upstox.com", "angel one": "https://www.angelone.in", "moneycontrol": "https://www.moneycontrol.com",
    "money control": "https://www.moneycontrol.com", "screener": "https://www.screener.in",
    "tradingview": "https://www.tradingview.com", "trading view": "https://www.tradingview.com",
    "nse": "https://www.nseindia.com", "bse": "https://www.bseindia.com", "tickertape": "https://www.tickertape.in",
    "economic times": "https://economictimes.indiatimes.com/markets", "sebi": "https://www.sebi.gov.in",
    "trendlyne": "https://trendlyne.com", "chartink": "https://chartink.com", "claude": "https://claude.ai",
    "instagram": "https://www.instagram.com", "insta": "https://www.instagram.com", "facebook": "https://www.facebook.com",
    "fb": "https://www.facebook.com", "telegram": "https://web.telegram.org", "x": "https://x.com",
    "google calendar": "https://calendar.google.com", "my calendar": "https://calendar.google.com",
    "google drive": "https://drive.google.com", "my drive": "https://drive.google.com", "google docs": "https://docs.google.com/document/u/0/",
    "docs": "https://docs.google.com/document/u/0/", "google sheets": "https://docs.google.com/spreadsheets/u/0/",
    "sheets": "https://docs.google.com/spreadsheets/u/0/", "google meet": "https://meet.google.com", "meet": "https://meet.google.com",
    "youtube studio": "https://studio.youtube.com", "google maps": "https://maps.google.com", "inbox": "https://mail.google.com",
    "email": "https://mail.google.com", "g mail": "https://mail.google.com", "whats app": "https://web.whatsapp.com",
    "whatsapp web": "https://web.whatsapp.com", "linked in": "https://www.linkedin.com", "you tube": "https://www.youtube.com",
}
# Installed Windows apps that register a link type. Tried first; the website is the fallback.
DESKTOP_APPS = {"whatsapp": "whatsapp:", "whats app": "whatsapp:", "telegram": "tg:"}
BUSINESS_APPS = ["gmail", "whatsapp", "google calendar"]
WEATHER_CODES = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
                 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain",
                 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers",
                 81: "rain showers", 82: "violent rain showers", 95: "thunderstorm", 96: "thunderstorm with hail",
                 99: "thunderstorm with hail"}
q = urllib.parse.quote_plus


# -- custom connections ("connect Jarvis to anything") -----------------------
def run_connection(j, conn, text):
    kind, target = conn.get("type", "url"), conn.get("target", "")
    if kind == "url":
        j.open_url(target)
    elif kind == "app":
        j.open_app(target)
    elif kind == "webhook":
        if conn.get("method", "POST").upper() == "GET":
            http_get(target, timeout=10)
        else:
            post_json(target, {"command": text, **conn.get("payload", {})}, timeout=10)
    else:
        return Reply(f"The connection type {kind} is not supported.")
    return Reply(conn.get("say") or "Done.")


def connection(j, m):
    text = m.string.lower()
    stripped = re.sub(r"^(open|launch|start|run|trigger|turn on|activate)\s+", "", text)
    for phrase, conn in j.cfg["connections"].items():
        if phrase.lower() in (text, stripped):
            return run_connection(j, conn, m.string)
    return None


# -- browser ------------------------------------------------------------------
def _site_name(raw):
    return re.sub(r"^(the|my)\s+|\s+(website|site|app|application|dot com|\.com|web|please)$", "", raw.lower().strip(" .,!?")).strip()


def open_one(j, name):
    """Open one app or site immediately. Returns the name actually opened."""
    if j.cfg.get("prefer_desktop_apps", True) and name in DESKTOP_APPS and sys.platform == "win32":
        try:
            j.open_app(DESKTOP_APPS[name])
            return name + " app"
        except OSError:
            pass  # app not installed: use the website
    if name in SITES:
        j.open_url(SITES[name])
    elif re.fullmatch(r"[\w\-]+(\.[\w\-]+)+(/\S*)?", name):
        j.open_url("https://" + name)
    else:
        j.open_url("https://www.google.com/search?q=" + q(name))   # unknown name: search for it rather than guess an address
    return name


def open_site(j, m):
    raw = m.group("name")
    if re.search(r"\b(business|work|my) (apps|applications)\b|\ball my apps\b", raw, re.I):
        names = [n.lower() for n in j.cfg.get("business_apps") or BUSINESS_APPS]
    else:
        names = [_site_name(x) for x in re.split(r",|\band\b|&", raw) if _site_name(x)]
    opened = [open_one(j, n) for n in names[:6]]
    return Reply("Opening " + (", ".join(opened[:-1]) + " and " + opened[-1] if len(opened) > 1 else opened[0]) + ".")


def youtube(j, m):
    j.open_url("https://www.youtube.com/results?search_query=" + q(m.group("what")))
    return Reply(f"Here is {m.group('what')} on YouTube.")


def search(j, m):
    j.open_url("https://www.google.com/search?q=" + q(m.group("what")))
    return Reply(f"Searching for {m.group('what')}.")


def maps(j, m):
    j.open_url("https://www.google.com/maps/search/" + q(m.group("place")))
    return Reply(f"Showing {m.group('place')} on the map.")


# -- information ---------------------------------------------------------------
def weather(j, m):
    city = (m.group("city") or "").strip() or j.cfg["city"]
    city = re.sub(r"^(in|at|for|of)\s+|\s+(today|now|right now|like)$", "", city).strip() or j.cfg["city"]
    geo = get_json("https://geocoding-api.open-meteo.com/v1/search", {"name": city, "count": 1}, ttl=86400)
    if not geo.get("results"):
        return Reply(f"I could not find a place called {city}.")
    g = geo["results"][0]
    w = get_json("https://api.open-meteo.com/v1/forecast", {
        "latitude": g["latitude"], "longitude": g["longitude"], "timezone": "auto", "forecast_days": 1,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max"}, ttl=600)
    c, d = w["current"], w["daily"]
    sky = WEATHER_CODES.get(c["weather_code"], "mixed conditions")
    return Reply(f"In {g['name']} it is {c['temperature_2m']:.0f} degrees with {sky}. Humidity {c['relative_humidity_2m']:.0f} "
                 f"percent, wind {c['wind_speed_10m']:.0f} kilometres per hour. Today's range is "
                 f"{d['temperature_2m_min'][0]:.0f} to {d['temperature_2m_max'][0]:.0f} degrees, with a "
                 f"{d['precipitation_probability_max'][0] or 0:.0f} percent chance of rain.")


def headlines(j, topic=None, limit=6):
    region = j.cfg["news_region"]
    tail = f"hl=en-{region}&gl={region}&ceid={region}:en"
    if topic in ("business", "market", "markets", "finance", "financial", "economy", "stock market"):
        url = f"https://news.google.com/rss/headlines/section/topic/BUSINESS?{tail}"
    elif topic:
        url = f"https://news.google.com/rss/search?q={q(topic)}&{tail}"
    else:
        url = f"https://news.google.com/rss?{tail}"
    root = ET.fromstring(http_get(url, ttl=300))
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").rsplit(" - ", 1)
        out.append({"title": title[0], "source": title[1] if len(title) > 1 else "", "link": item.findtext("link") or ""})
        if len(out) >= limit:
            break
    return out


def news(j, m):
    topic = re.sub(r"^(about|on|for|of|from|in|regarding)\s+|\b(the|latest|today'?s?|headlines?|please)\b", " ",
                   (m.group("topic") or "").lower())
    topic = " ".join(topic.split()) or None
    lead = " ".join((m.group("lead") or "").lower().replace("latest", "").replace("top", "").split())
    topic = topic or (lead if lead in ("business", "market", "markets", "finance", "financial", "economy") else None)
    items = headlines(j, topic)
    if not items:
        return Reply("I found no headlines for that.")
    speech = f"Here are the top headlines{' on ' + topic if topic else ''}. " + " ".join(
        f"{i}. {h['title']}." for i, h in enumerate(items[:4], 1))
    return Reply(speech, {"title": f"News{' · ' + topic if topic else ''}", "columns": ["Headline", "Source"],
                          "rows": [[{"text": h["title"], "href": h["link"]}, h["source"]] for h in items]})


def wiki_summary(topic):
    try:
        hits = get_json("https://en.wikipedia.org/w/api.php", {"action": "opensearch", "search": topic, "limit": 1,
                                                               "format": "json"}, ttl=3600)
        if not hits[1]:
            return None
        title = hits[1][0]
        page = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_")),
                        ttl=3600)
    except (OSError, ValueError, IndexError):
        return None
    text = page.get("extract") or ""
    if page.get("type") == "disambiguation" or not text:
        return None
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return title, " ".join(sentences[:3])


def wikipedia(j, m):
    topic = re.sub(r"\b(wikipedia|search|on|in|from|according to|for|tell me about)\b", " ", m.group("topic"), flags=re.I)
    topic = " ".join(topic.split())
    found = wiki_summary(topic) if topic else None
    if not found:
        return None  # let the AI brain or the fallback take it
    return Reply(found[1], {"title": found[0], "columns": ["Wikipedia"], "rows": [[found[1]]]})


def define(j, m):
    word = m.group("word").strip().split()[-1]
    try:
        data = get_json("https://api.dictionaryapi.dev/api/v2/entries/en/" + urllib.parse.quote(word), ttl=86400)
        meaning = data[0]["meanings"][0]
        return Reply(f"{word}, {meaning['partOfSpeech']}: {meaning['definitions'][0]['definition']}")
    except (OSError, KeyError, IndexError, TypeError, ValueError):
        return Reply(f"I could not find a definition for {word}.")


# -- email -----------------------------------------------------------------------
def send_email(j, m):
    who, body = m.group("who").strip(), m.group("body").strip()
    contacts = {k.lower(): v for k, v in j.cfg["contacts"].items()}
    to = who if "@" in who else contacts.get(who.lower())
    conf, password = j.cfg["email"], os.environ.get("JARVIS_EMAIL_PASSWORD")
    if not to:
        return Reply(f"I do not have an email address for {who}. Add them under contacts in config.json.")
    if not conf.get("address") or not password:
        return Reply("Email is not set up yet. Put your address in config.json and JARVIS_EMAIL_PASSWORD in the .env file.")
    msg = EmailMessage()
    msg["From"], msg["To"] = conf["address"], to
    msg["Subject"] = body[:60].capitalize()
    msg.set_content(body.capitalize() + f"\n\n— Sent by {j.cfg['assistant_name']}")
    with smtplib.SMTP(conf["smtp_host"], conf["smtp_port"], timeout=20) as s:
        s.starttls()
        s.login(conf["address"], password)
        s.send_message(msg)
    return Reply(f"Email sent to {who}.")


def register_early(j):
    j.on(r".+", connection)


def register(j):
    j.on(r"\b(?:send )?(?:an? )?(?:email|mail) (?:to )?(?P<who>.+?) (?:saying|that says|that|about|message) (?P<body>.+)",
         send_email)
    j.on(r"\b(?P<lead>(?:latest |top )?(?:business |market |financial |finance |economy )?)(?:news|headlines)\b(?P<topic>.*)", news)
    j.on(r"\b(?:weather|temperature|forecast)\b(?P<city>.*)", weather)
    j.on(r"\b(?:meaning|definition) of (?P<word>.+)|^define (?P<word2>.+)",
         lambda j, m: define(j, _Word(m)))
    j.on(r"\b(?:play|search youtube for|youtube search for|search)\s+(?P<what>.+?)\s+(?:on|in) youtube$", youtube)
    j.on(r"\b(?:search youtube for|youtube)\s+(?P<what>.+)", youtube)
    j.on(r"\b(?:where is|locate|directions to|navigate to|show (?:me )?)\s*(?P<place>.+?)(?:\s+on (?:the |google )?maps?)?$"
         r"(?<=map|aps)|\b(?:where is|locate|directions to|navigate to)\s+(?P<place2>.+)",
         lambda j, m: maps(j, _Place(m)))
    j.on(r"^(?:search|google|look up|find)(?: google)?(?: for| about)?\s+(?P<what>.+)", search)
    j.on(r"^(?:open|launch|go to|start)\s+(?P<name>.+)", open_site)


def register_late(j):
    j.on(r"^(?:who|what) (?:is|was|are|were) (?:an? |the )?(?P<topic>.+)|\bwikipedia\b(?P<topic2>.*)|"
         r"^tell me about (?P<topic3>.+)", lambda j, m: wikipedia(j, _Topic(m)))


class _Alt:
    """Present whichever alternative named group matched under one name."""
    names, key = (), ""

    def __init__(self, m):
        self.m, self.string = m, m.string

    def group(self, name=0):
        if name == self.key:
            return next((self.m.group(n) for n in self.names if self.m.group(n)), "") or self.m.string
        return self.m.group(name)


class _Word(_Alt):
    names, key = ("word", "word2"), "word"


class _Place(_Alt):
    names, key = ("place", "place2"), "place"


class _Topic(_Alt):
    names, key = ("topic", "topic2", "topic3"), "topic"
