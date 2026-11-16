"""Small shared helpers: HTTP, number parsing, money formatting."""
import json
import re
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
_cache = {}


def http_get(url, params=None, timeout=8, ttl=0, headers=None):
    """GET a URL and return the body as text. Raises OSError on failure."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    now = time.time()
    if ttl and url in _cache and now - _cache[url][0] < ttl:
        return _cache[url][1]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
    if ttl:
        _cache[url] = (now, body)
    return body


def get_json(url, params=None, timeout=8, ttl=0):
    return json.loads(http_get(url, params, timeout, ttl))


def post_json(url, payload, timeout=8, headers=None):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", "User-Agent": UA, **(headers or {})}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


UNITS = {
    "k": 1e3, "thousand": 1e3, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5,
    "crore": 1e7, "crores": 1e7, "cr": 1e7, "million": 1e6, "billion": 1e9,
}
NUM_RE = r"(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr|million|billion)?\b"


def parse_number(text):
    """'2,900 rupees' -> 2900.0, '5 lakh' -> 500000.0. None if no number."""
    m = re.search(NUM_RE, str(text).lower())
    if not m:
        return None
    return float(m.group(1).replace(",", "")) * UNITS.get(m.group(2) or "", 1)


CURRENCY_SIGN = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}


def _group_indian(whole):
    s = str(whole)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def money(value, currency="INR", decimals=2):
    """Format with currency sign; Indian digit grouping for rupees."""
    if value is None:
        return "n/a"
    sign = "-" if value < 0 else ""
    value = abs(value)
    whole, frac = f"{value:.{decimals}f}".partition(".")[::2]
    grouped = _group_indian(whole) if currency == "INR" else f"{int(whole):,}"
    out = grouped + ("." + frac if decimals else "")
    return f"{sign}{CURRENCY_SIGN.get(currency, currency + ' ')}{out}"


def spoken_inr(value):
    """Round rupee amounts into lakh / crore so they are easy to hear."""
    a = abs(value)
    sign = "minus " if value < 0 else ""
    if a >= 1e7:
        return f"{sign}{a / 1e7:.2f} crore rupees"
    if a >= 1e5:
        return f"{sign}{a / 1e5:.2f} lakh rupees"
    return f"{sign}{a:,.0f} rupees"


def pct(value):
    return "n/a" if value is None else f"{value:+.2f}%"
