"""Investment calculators and currency conversion."""
import re

from ..core import Reply
from ..util import NUM_RE, UNITS, money, spoken_inr
from . import market

CURRENCIES = {
    "rupee": "INR", "rupees": "INR", "inr": "INR", "dollar": "USD", "dollars": "USD", "usd": "USD",
    "euro": "EUR", "euros": "EUR", "eur": "EUR", "pound": "GBP", "pounds": "GBP", "gbp": "GBP",
    "yen": "JPY", "jpy": "JPY", "dirham": "AED", "dirhams": "AED", "aed": "AED",
    "sgd": "SGD", "singapore dollar": "SGD", "singapore dollars": "SGD",
}


def _terms(text, default_rate=12.0):
    """Pull (amount, years, rate%) out of a spoken sentence."""
    t = text.lower()
    years = rate = None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:years?|yrs?)", t)
    if m:
        years = float(m.group(1))
        t = t.replace(m.group(0), " ")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)", t)
    if m:
        rate = float(m.group(1))
        t = t.replace(m.group(0), " ")
    m = re.search(NUM_RE, t)
    amount = float(m.group(1).replace(",", "")) * UNITS.get(m.group(2) or "", 1) if m else None
    return amount, years, rate if rate is not None else default_rate


def sip_value(monthly, years, rate):
    i, n = rate / 100 / 12, int(round(years * 12))
    return monthly * n if i == 0 else monthly * ((1 + i) ** n - 1) / i * (1 + i)


def sip(j, m):
    amount, years, rate = _terms(m.string)
    if not amount or not years:
        return Reply("Tell me the amount and period, for example: SIP of 10,000 a month for 15 years at 12 percent.")
    fv, invested = sip_value(amount, years, rate), amount * years * 12
    return Reply(f"A monthly SIP of {money(amount, decimals=0)} for {years:g} years at {rate:g} percent grows to about "
                 f"{spoken_inr(fv)}. You invest {spoken_inr(invested)} and earn {spoken_inr(fv - invested)}.",
                 {"title": "SIP projection", "columns": ["", ""],
                  "rows": [["Monthly investment", money(amount, decimals=0)], ["Period", f"{years:g} years"],
                           ["Assumed return", f"{rate:g}% p.a."], ["Total invested", money(invested, decimals=0)],
                           ["Estimated gains", money(fv - invested, decimals=0)],
                           ["Future value", money(fv, decimals=0)]]})


def lumpsum(j, m):
    amount, years, rate = _terms(m.string)
    if not amount or not years:
        return Reply("Tell me the amount and period, for example: lump sum of 5 lakh for 10 years at 12 percent.")
    fv = amount * (1 + rate / 100) ** years
    return Reply(f"{spoken_inr(amount)} invested for {years:g} years at {rate:g} percent grows to about "
                 f"{spoken_inr(fv)}, which is {fv / amount:.1f} times your money.",
                 {"title": "Lump sum projection", "columns": ["", ""],
                  "rows": [["Invested", money(amount, decimals=0)], ["Period", f"{years:g} years"],
                           ["Assumed return", f"{rate:g}% p.a."], ["Future value", money(fv, decimals=0)]]})


def cagr(j, m):
    nums = [float(x.replace(",", "")) * UNITS.get(u or "", 1) for x, u in re.findall(NUM_RE, m.string.lower())]
    if len(nums) < 3 or nums[0] <= 0 or nums[2] <= 0:
        return Reply("Say it like this: CAGR from 100 to 250 in 5 years.")
    start, end, years = nums[:3]
    rate = ((end / start) ** (1 / years) - 1) * 100
    return Reply(f"Growing from {start:,.0f} to {end:,.0f} in {years:g} years is a CAGR of {rate:.2f} percent.")


def convert(j, m):
    src, dst = CURRENCIES.get(m.group("src").lower()), CURRENCIES.get(m.group("dst").lower())
    amount = float(m.group("amt").replace(",", "")) * UNITS.get((m.group("unit") or "").lower(), 1)
    if not src or not dst:
        return None
    if src == dst:
        return Reply("Those are the same currency.")
    q = market.quote(f"{src}{dst}=X")
    if not q:
        return Reply("I could not get the exchange rate right now.")
    return Reply(f"{money(amount, src)} is {money(amount * q['price'], dst)} at a rate of {q['price']:.4f}.")


def register(j):
    cur = "|".join(sorted(CURRENCIES, key=len, reverse=True))
    j.on(r"\bconvert\s+(?P<amt>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>k|thousand|lakhs?|crores?|million|billion)?\s*"
         rf"(?P<src>{cur})\s+(?:to|into|in)\s+(?P<dst>{cur})\b", convert)
    j.on(r"\bcagr\b|compound(ed)? annual growth", cagr)
    j.on(r"\b(sip|s\.i\.p|systematic investment|monthly investment|invest(ing)? .* (a|per|every) month)\b", sip)
    j.on(r"\b(lump ?sum|one[- ]time investment)\b|\binvest(ed|ing)?\b.*\byears?\b", lumpsum)
