"""Live market data (Yahoo Finance public endpoints, no API key needed)."""
import datetime as dt
import re
from concurrent.futures import ThreadPoolExecutor

from ..core import Reply
from ..util import get_json, money, pct

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"

ALIASES = {
    "nifty": "^NSEI", "nifty 50": "^NSEI", "nifty fifty": "^NSEI", "sensex": "^BSESN",
    "bank nifty": "^NSEBANK", "nifty bank": "^NSEBANK", "nifty it": "^CNXIT",
    "midcap": "^NSEMDCP50", "india vix": "^INDIAVIX", "vix": "^INDIAVIX",
    "dow": "^DJI", "dow jones": "^DJI", "nasdaq": "^IXIC", "s&p": "^GSPC", "s and p": "^GSPC",
    "s&p 500": "^GSPC", "gold": "GC=F", "silver": "SI=F", "crude": "CL=F", "crude oil": "CL=F",
    "brent": "BZ=F", "bitcoin": "BTC-USD", "ethereum": "ETH-USD",
    "dollar": "USDINR=X", "usd inr": "USDINR=X", "usdinr": "USDINR=X", "euro": "EURINR=X",
    "reliance": "RELIANCE.NS", "tcs": "TCS.NS", "infosys": "INFY.NS", "infy": "INFY.NS",
    "hdfc bank": "HDFCBANK.NS", "icici bank": "ICICIBANK.NS", "sbi": "SBIN.NS",
    "state bank": "SBIN.NS", "state bank of india": "SBIN.NS", "axis bank": "AXISBANK.NS",
    "kotak": "KOTAKBANK.NS", "kotak bank": "KOTAKBANK.NS", "itc": "ITC.NS", "l&t": "LT.NS",
    "larsen": "LT.NS", "wipro": "WIPRO.NS", "hcl": "HCLTECH.NS", "hcl tech": "HCLTECH.NS",
    "airtel": "BHARTIARTL.NS", "bharti airtel": "BHARTIARTL.NS", "maruti": "MARUTI.NS",
    "tata motors": "TATAMOTORS.NS", "tata steel": "TATASTEEL.NS", "tata power": "TATAPOWER.NS",
    "bajaj finance": "BAJFINANCE.NS", "asian paints": "ASIANPAINT.NS", "titan": "TITAN.NS",
    "hul": "HINDUNILVR.NS", "hindustan unilever": "HINDUNILVR.NS", "sun pharma": "SUNPHARMA.NS",
    "dr reddy": "DRREDDY.NS", "dr reddys": "DRREDDY.NS", "cipla": "CIPLA.NS", "lupin": "LUPIN.NS",
    "divis": "DIVISLAB.NS", "biocon": "BIOCON.NS", "zydus": "ZYDUSLIFE.NS",
    "adani enterprises": "ADANIENT.NS", "adani ports": "ADANIPORTS.NS", "ongc": "ONGC.NS",
    "ntpc": "NTPC.NS", "power grid": "POWERGRID.NS", "coal india": "COALINDIA.NS",
    "zomato": "ETERNAL.NS", "paytm": "PAYTM.NS", "lic": "LICI.NS", "irctc": "IRCTC.NS",
    "apple": "AAPL", "microsoft": "MSFT", "google": "GOOGL", "amazon": "AMZN", "tesla": "TSLA",
    "nvidia": "NVDA", "meta": "META",
}
INDEX_NAMES = {"^NSEI": "Nifty 50", "^BSESN": "Sensex", "^NSEBANK": "Bank Nifty", "USDINR=X": "USD/INR",
               "GC=F": "Gold", "CL=F": "Crude oil", "SI=F": "Silver", "^INDIAVIX": "India VIX",
               "BTC-USD": "Bitcoin"}
NOISE = r"\b(the|a|an|stock|stocks|share|shares|price|of|for|company|ltd|limited|today|now|currently|please|right)\b"


def clean_name(name):
    name = re.sub(NOISE, " ", name.lower())
    return " ".join(re.sub(r"[^a-z0-9&^.=\- ]", " ", name).split())


def resolve(j, name):
    """Company name / ticker spoken by the user -> Yahoo symbol (or None)."""
    key = clean_name(name)
    if not key:
        return None
    if key in ALIASES:
        return ALIASES[key]
    cache = j.store["symbols"]
    if key in cache:
        return cache[key]
    if re.fullmatch(r"\^?[a-z0-9&\-]+(\.[a-z]{1,3}|=[a-z])", key):
        return key.upper()
    data = get_json(SEARCH, {"q": key, "quotesCount": 8, "newsCount": 0}, ttl=3600)
    found = [q for q in data.get("quotes", []) if q.get("symbol")]
    symbol = None
    for suffix in j.cfg["preferred_exchanges"]:
        symbol = next((q["symbol"] for q in found if q["symbol"].endswith(suffix)), None)
        if symbol:
            break
    if not symbol and found:
        symbol = found[0]["symbol"]
    if symbol:
        with j.store.lock:
            cache[key] = symbol
            j.store.save()
    return symbol


def quote(symbol):
    """Latest price snapshot for one symbol, or None if unavailable."""
    try:
        data = get_json(CHART + symbol, {"range": "5d", "interval": "1d"}, ttl=20)
        res = data["chart"]["result"][0]
    except (OSError, KeyError, TypeError, IndexError, ValueError):
        return None
    meta = res["meta"]
    price = meta.get("regularMarketPrice")
    if price is None:
        return None
    stamps = res.get("timestamp") or []
    closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
    days = {}
    for ts, c in zip(stamps, closes):  # one close per calendar day, latest wins
        if c is not None:
            days[dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()] = c
    series = [days[d] for d in sorted(days)]
    prev = series[-2] if len(series) >= 2 else meta.get("chartPreviousClose") or meta.get("previousClose")
    change = price - prev if prev else None
    return {
        "symbol": symbol,
        "name": INDEX_NAMES.get(symbol) or meta.get("shortName") or meta.get("longName") or symbol,
        "price": price, "prev": prev, "change": change,
        "pct": change / prev * 100 if prev else None,
        "currency": meta.get("currency") or "INR",
        "high": meta.get("regularMarketDayHigh"), "low": meta.get("regularMarketDayLow"),
        "hi52": meta.get("fiftyTwoWeekHigh"), "lo52": meta.get("fiftyTwoWeekLow"),
        "volume": meta.get("regularMarketVolume"),
    }


def quotes(symbols):
    symbols = list(dict.fromkeys(symbols))
    if not symbols:
        return {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        return {s: q for s, q in zip(symbols, pool.map(quote, symbols)) if q}


def direction(q):
    if q["pct"] is None:
        return "flat"
    return f"{'up' if q['pct'] >= 0 else 'down'} {abs(q['pct']):.2f} percent"


def is_index(symbol):
    return symbol.startswith("^")


def price_text(q):
    return f"{q['price']:,.2f}" if is_index(q["symbol"]) else money(q["price"], q["currency"])


def quote_rows(qs):
    return [[q["name"], price_text(q), pct(q["pct"])] for q in qs]


# -- voice handlers ------------------------------------------------------
def say_quote(j, m):
    name = m.group("name")
    symbol = resolve(j, name)
    if not symbol:
        return None if m.re.pattern.startswith("(?:how") else Reply(f"I could not find a listed company called {name}.")
    q = quote(symbol)
    if not q:
        return Reply(f"I found {symbol} but could not get a price for it right now.")
    speech = f"{q['name']} is at {price_text(q)}, {direction(q)} today."
    if q["hi52"] and q["lo52"]:
        speech += f" 52 week range is {q['lo52']:,.0f} to {q['hi52']:,.0f}."
    rows = [["Price", price_text(q)], ["Change", pct(q["pct"])],
            ["Day range", f"{q['low'] or 0:,.2f} – {q['high'] or 0:,.2f}"],
            ["52-week range", f"{q['lo52'] or 0:,.2f} – {q['hi52'] or 0:,.2f}"],
            ["Volume", f"{q['volume']:,}" if q["volume"] else "n/a"]]
    return Reply(speech, {"title": f"{q['name']} ({symbol})", "columns": ["", ""], "rows": rows})


def market_update(j, m):
    qs = quotes(j.cfg["ticker"])
    if not qs:
        return Reply("I could not reach the market data service right now.")
    ordered = [qs[s] for s in j.cfg["ticker"] if s in qs]
    speech = "Market update. " + " ".join(f"{q['name']} is at {q['price']:,.0f}, {direction(q)}." for q in ordered[:4])
    from .portfolio import snapshot
    snap = snapshot(j)
    if snap and snap["rows"]:
        t = snap["totals"][0]
        speech += f" Your portfolio is {'up' if t['day'] >= 0 else 'down'} {money(abs(t['day']), t['currency'], 0)} today."
    return Reply(speech, {"title": "Markets", "columns": ["Instrument", "Last", "Change"], "rows": quote_rows(ordered)})


def open_chart(j, m):
    symbol = resolve(j, m.group("name"))
    if not symbol:
        return Reply(f"I could not find {m.group('name')}.")
    base = symbol.split(".")[0]
    if m.group("kind").lower().startswith("chart"):
        prefix = "NSE:" if symbol.endswith(".NS") else "BSE:" if symbol.endswith(".BO") else ""
        j.open_url(f"https://www.tradingview.com/chart/?symbol={prefix}{base}")
        return Reply(f"Opening the chart for {base}.")
    j.open_url(f"https://www.screener.in/company/{base}/")
    return Reply(f"Opening fundamentals for {base} on Screener.")


def register(j):
    j.on(r"\b(market (update|summary|status|report|news today)|how(?:'s| is| are) the markets?( doing| today)?|"
         r"(morning|market|daily) brief(ing)?|markets? today)\b", market_update)
    j.on(r"\b(?P<kind>chart|fundamentals|screener|financials)\s+(of|for)\s+(?P<name>.+)", open_chart)
    j.on(r"\b(?:price|quote|rate|value)\s+(?:of|for)\s+(?P<name>.+)", say_quote)
    j.on(r"^(?:what(?:'s| is)|tell me|check|show(?: me)?)?\s*(?P<name>.+?)\s+(?:share|stock)s?\s*(?:price|rate|quote)?$", say_quote)
    j.on(r"^what(?:'s| is)\s+(?P<name>.+?)\s+(?:trading|quoting)(?: at)?$", say_quote)
    j.on(r"(?:how(?:'s| is))\s+(?P<name>.+?)\s+(?:doing|performing|trading)(?: today)?$", say_quote)
