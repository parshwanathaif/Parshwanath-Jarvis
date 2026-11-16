"""Canned responses standing in for the live internet services."""
import time

PRICES = {  # symbol: (previous close, last price, currency, name)
    "RELIANCE.NS": (2900.0, 2958.0, "INR", "Reliance Industries"),
    "TCS.NS": (4100.0, 4018.0, "INR", "Tata Consultancy"),
    "CIPLA.NS": (1500.0, 1515.0, "INR", "Cipla"),
    "^NSEI": (25000.0, 25250.0, "INR", "NIFTY 50"),
    "^BSESN": (82000.0, 82410.0, "INR", "SENSEX"),
    "^NSEBANK": (54000.0, 53730.0, "INR", "BANK NIFTY"),
    "USDINR=X": (88.0, 88.2, "INR", "USD/INR"),
    "GC=F": (4000.0, 4040.0, "USD", "Gold"),
    "CL=F": (60.0, 59.4, "USD", "Crude"),
}
RSS = """<rss><channel>
<item><title>Sensex ends higher on pharma rally - Mint</title><link>https://example.com/a</link></item>
<item><title>RBI holds rates steady - Economic Times</title><link>https://example.com/b</link></item>
</channel></rss>"""


def get_json(url, params=None, timeout=8, ttl=0):
    params = params or {}
    if "/finance/chart/" in url:
        symbol = url.rsplit("/", 1)[1]
        if symbol not in PRICES:
            raise OSError("404")
        prev, last, cur, name = PRICES[symbol]
        now = int(time.time())
        return {"chart": {"result": [{
            "meta": {"regularMarketPrice": last, "currency": cur, "shortName": name, "chartPreviousClose": prev * 0.9,
                     "regularMarketDayHigh": last * 1.01, "regularMarketDayLow": last * 0.99,
                     "fiftyTwoWeekHigh": last * 1.2, "fiftyTwoWeekLow": last * 0.7, "regularMarketVolume": 1234567},
            "timestamp": [now - 3 * 86400, now - 86400, now],
            "indicators": {"quote": [{"close": [prev * 0.98, prev, last]}]}}]}}
    if "/finance/search" in url:
        hits = {"cipla": [{"symbol": "CIPLA.BO"}, {"symbol": "CIPLA.NS"}], "apollo hospitals": [{"symbol": "APOLLOHOSP.NS"}]}
        return {"quotes": hits.get(params.get("q"), [])}
    if "geocoding-api" in url:
        return {"results": [{"name": "Mumbai", "latitude": 19.07, "longitude": 72.87}]}
    if "open-meteo" in url:
        return {"current": {"temperature_2m": 31.2, "relative_humidity_2m": 62, "wind_speed_10m": 14, "weather_code": 2},
                "daily": {"temperature_2m_max": [33.0], "temperature_2m_min": [25.0], "precipitation_probability_max": [10]}}
    if "wikipedia.org/w/api.php" in url:
        return [params["search"], ["Warren Buffett"] if "buffett" in params["search"].lower() else []]
    if "wikipedia.org/api/rest_v1" in url:
        return {"type": "standard", "extract": "Warren Buffett is an American investor. He chairs Berkshire Hathaway."}
    if "dictionaryapi" in url:
        return [{"meanings": [{"partOfSpeech": "noun", "definitions": [{"definition": "buying and selling to profit from price gaps"}]}]}]
    raise OSError("unexpected url " + url)


def http_get(url, params=None, timeout=8, ttl=0, headers=None):
    if "news.google.com" in url:
        return RSS
    raise OSError("unexpected url " + url)


def install():
    from jarvis.skills import market, web
    market.get_json = get_json
    web.get_json = get_json
    web.http_get = http_get
