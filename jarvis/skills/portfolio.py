"""Portfolio, watchlist and price alerts."""
import csv
import datetime as dt
import os
import re
import threading

from ..config import ROOT
from ..core import Reply
from ..util import money, parse_number, pct
from . import market

QTY = r"(?P<qty>\d[\d,]*(?:\.\d+)?)"
PRICE = (r"(?:rs\.?|rupees|inr|₹|\$)?\s*(?P<price>\d[\d,]*(?:\.\d+)?"
         r"(?:\s*(?:k|thousand|lakhs?|lacs?|crores?|cr)\b)?)")


def _holding(j, symbol):
    return j.store["portfolio"].get(symbol)


def trade(j, symbol, qty, price, side):
    """Apply a buy/sell to the holdings using average-cost accounting."""
    with j.store.lock:
        book = j.store["portfolio"]
        h = book.get(symbol, {"qty": 0.0, "avg": 0.0})
        if side == "buy":
            total = h["qty"] * h["avg"] + qty * price
            h["qty"] += qty
            h["avg"] = total / h["qty"]
            book[symbol] = h
            realised = None
        else:
            if qty > h["qty"] + 1e-9:
                raise ValueError(f"you only hold {h['qty']:g} of {symbol}")
            realised = (price - h["avg"]) * qty
            h["qty"] -= qty
            j.store["realised"].append({"date": dt.date.today().isoformat(), "symbol": symbol,
                                        "qty": qty, "price": price, "pnl": round(realised, 2)})
            if h["qty"] <= 1e-9:
                book.pop(symbol, None)
            else:
                book[symbol] = h
        j.store.save()
    return realised


def import_csv(j, path=None):
    """Load holdings from data/portfolio.csv (columns: symbol, qty, avg_price)."""
    path = path or os.path.join(ROOT, "data", "portfolio.csv")
    if not os.path.exists(path):
        return 0
    count = 0
    with open(path, newline="", encoding="utf-8-sig") as f, j.store.lock:
        for row in csv.DictReader(f):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            name = row.get("symbol") or row.get("name")
            qty = parse_number(row.get("qty") or row.get("quantity") or "")
            avg = parse_number(row.get("avg_price") or row.get("avg") or row.get("price") or "")
            if not name or not qty or avg is None:
                continue
            symbol = market.resolve(j, name) if "." not in name and not name.startswith("^") else name.upper()
            if symbol:
                j.store["portfolio"][symbol] = {"qty": qty, "avg": avg}
                count += 1
        j.store.save()
    return count


def snapshot(j):
    """Value every holding at the live price. Totals are grouped by currency."""
    book = dict(j.store["portfolio"])
    if not book:
        return {"rows": [], "totals": []}
    qs = market.quotes(book)
    rows, totals = [], {}
    for symbol, h in book.items():
        q = qs.get(symbol)
        cur = q["currency"] if q else "INR"
        ltp = q["price"] if q else None
        invested = h["qty"] * h["avg"]
        value = h["qty"] * ltp if ltp is not None else invested
        day = h["qty"] * q["change"] if q and q["change"] is not None else 0.0
        rows.append({"symbol": symbol, "name": q["name"] if q else symbol, "qty": h["qty"], "avg": h["avg"],
                     "ltp": ltp, "day_pct": q["pct"] if q else None, "currency": cur, "invested": invested,
                     "value": value, "pnl": value - invested,
                     "pnl_pct": (value - invested) / invested * 100 if invested else 0.0, "day": day})
        t = totals.setdefault(cur, {"currency": cur, "invested": 0.0, "value": 0.0, "day": 0.0})
        t["invested"] += invested
        t["value"] += value
        t["day"] += day
    for t in totals.values():
        t["pnl"] = t["value"] - t["invested"]
        t["pnl_pct"] = t["pnl"] / t["invested"] * 100 if t["invested"] else 0.0
    rows.sort(key=lambda r: -r["value"])
    return {"rows": rows, "totals": sorted(totals.values(), key=lambda t: -t["value"])}


def panel(snap):
    rows = [[r["symbol"].split(".")[0], f"{r['qty']:g}", money(r["avg"], r["currency"]),
             money(r["ltp"], r["currency"]), pct(r["day_pct"]), money(r["value"], r["currency"], 0),
             money(r["pnl"], r["currency"], 0), pct(r["pnl_pct"])] for r in snap["rows"]]
    for t in snap["totals"]:
        rows.append(["TOTAL", "", "", "", money(t["day"], t["currency"], 0), money(t["value"], t["currency"], 0),
                     money(t["pnl"], t["currency"], 0), pct(t["pnl_pct"])])
    return {"title": "Portfolio", "columns": ["Stock", "Qty", "Avg", "LTP", "Day", "Value", "P&L", "P&L %"],
            "rows": rows}


# -- voice handlers ------------------------------------------------------
def show_portfolio(j, m):
    snap = snapshot(j)
    if not snap["rows"]:
        return Reply("Your portfolio is empty. Say, for example, 'I bought 10 shares of Reliance at 2900', "
                     "or put a portfolio.csv file in the data folder and say 'import portfolio'.")
    parts = []
    for t in snap["totals"]:
        parts.append(f"Your portfolio is worth {money(t['value'], t['currency'], 0)}, "
                     f"{'a gain' if t['pnl'] >= 0 else 'a loss'} of {money(abs(t['pnl']), t['currency'], 0)}, "
                     f"that is {abs(t['pnl_pct']):.1f} percent. "
                     f"Today it is {'up' if t['day'] >= 0 else 'down'} {money(abs(t['day']), t['currency'], 0)}.")
    best = max(snap["rows"], key=lambda r: r["pnl_pct"])
    worst = min(snap["rows"], key=lambda r: r["pnl_pct"])
    if len(snap["rows"]) > 1:
        parts.append(f"Best performer is {best['name']} at {best['pnl_pct']:+.1f} percent, "
                     f"weakest is {worst['name']} at {worst['pnl_pct']:+.1f} percent.")
    return Reply(" ".join(parts), panel(snap))


def movers(j, m):
    snap = snapshot(j)
    rows = [r for r in snap["rows"] if r["day_pct"] is not None]
    if not rows:
        return Reply("There are no holdings to rank yet.")
    losers = bool(re.search(r"los|worst|lagg", m.group(0), re.I))
    rows.sort(key=lambda r: r["day_pct"], reverse=not losers)
    top = rows[:3]
    speech = f"Today's top {'losers' if losers else 'gainers'} in your portfolio: " + ", ".join(
        f"{r['name']} {r['day_pct']:+.1f} percent" for r in top) + "."
    return Reply(speech, {"title": "Movers today", "columns": ["Stock", "LTP", "Day"],
                          "rows": [[r["name"], money(r["ltp"], r["currency"]), pct(r["day_pct"])] for r in rows]})


def do_trade(j, m):
    side = "sell" if m.group("side").lower().startswith("s") else "buy"
    symbol = market.resolve(j, m.group("name"))
    if not symbol:
        return Reply(f"I could not find a listed company called {m.group('name')}.")
    qty = parse_number(m.group("qty"))
    price = parse_number(m.group("price")) if m.group("price") else None
    if price is None:
        q = market.quote(symbol)
        if not q:
            return Reply(f"Please tell me the price, for example: bought {qty:g} {m.group('name')} at 2900.")
        price = q["price"]
    try:
        realised = trade(j, symbol, qty, price, side)
    except ValueError as e:
        return Reply(f"I cannot record that sale, {e}.")
    base = symbol.split(".")[0]
    if side == "buy":
        h = _holding(j, symbol)
        return Reply(f"Recorded. Bought {qty:g} {base} at {money(price)}. "
                     f"You now hold {h['qty']:g} at an average of {money(h['avg'])}.")
    return Reply(f"Recorded. Sold {qty:g} {base} at {money(price)}, "
                 f"realised {'profit' if realised >= 0 else 'loss'} of {money(abs(realised), decimals=0)}.")


def remove_holding(j, m):
    symbol = market.resolve(j, m.group("name"))
    with j.store.lock:
        if not symbol or j.store["portfolio"].pop(symbol, None) is None:
            return Reply(f"{m.group('name')} is not in your portfolio.")
        j.store.save()
    return Reply(f"Removed {symbol.split('.')[0]} from your portfolio.")


def do_import(j, m):
    n = import_csv(j)
    return Reply(f"Imported {n} holdings from portfolio.csv." if n else
                 "I did not find data/portfolio.csv with columns symbol, qty and avg_price.")


def realised_pnl(j, m):
    items = j.store["realised"]
    if not items:
        return Reply("No sales recorded yet, so there is no realised profit or loss.")
    total = sum(i["pnl"] for i in items)
    return Reply(f"Realised {'profit' if total >= 0 else 'loss'} so far is {money(abs(total), decimals=0)} "
                 f"across {len(items)} sales.",
                 {"title": "Realised P&L", "columns": ["Date", "Stock", "Qty", "Price", "P&L"],
                  "rows": [[i["date"], i["symbol"].split(".")[0], f"{i['qty']:g}", money(i["price"]),
                            money(i["pnl"], decimals=0)] for i in items[-15:]]})


def watch_add(j, m):
    symbol = market.resolve(j, m.group("name"))
    if not symbol:
        return Reply(f"I could not find {m.group('name')}.")
    with j.store.lock:
        if symbol not in j.store["watchlist"]:
            j.store["watchlist"].append(symbol)
            j.store.save()
    return Reply(f"Added {symbol.split('.')[0]} to your watchlist.")


def watch_remove(j, m):
    symbol = market.resolve(j, m.group("name"))
    with j.store.lock:
        if symbol not in j.store["watchlist"]:
            return Reply(f"{m.group('name')} is not on your watchlist.")
        j.store["watchlist"].remove(symbol)
        j.store.save()
    return Reply(f"Removed {symbol.split('.')[0]} from your watchlist.")


def watch_show(j, m):
    wl = list(j.store["watchlist"])
    if not wl:
        return Reply("Your watchlist is empty. Say 'add Infosys to my watchlist'.")
    qs = market.quotes(wl)
    ordered = [qs[s] for s in wl if s in qs]
    speech = "Watchlist. " + " ".join(f"{q['name']}, {market.price_text(q)}, {market.direction(q)}." for q in ordered[:6])
    return Reply(speech, {"title": "Watchlist", "columns": ["Stock", "Last", "Change"],
                          "rows": market.quote_rows(ordered)})


def alert_add(j, m):
    symbol = market.resolve(j, m.group("name"))
    if not symbol:
        return Reply(f"I could not find {m.group('name')}.")
    level = parse_number(m.group("price"))
    above = m.group("dir").lower() in ("above", "over", "crosses", "exceeds", "reaches", "hits")
    with j.store.lock:
        j.store["alerts"].append({"symbol": symbol, "above": above, "level": level})
        j.store.save()
    return Reply(f"Alert set. I will tell you when {symbol.split('.')[0]} goes "
                 f"{'above' if above else 'below'} {level:,.2f}.")


def alert_show(j, m):
    alerts = j.store["alerts"]
    if not alerts:
        return Reply("You have no price alerts.")
    return Reply(f"You have {len(alerts)} price alerts.",
                 {"title": "Price alerts", "columns": ["Stock", "Condition", "Level"],
                  "rows": [[a["symbol"].split(".")[0], "above" if a["above"] else "below", f"{a['level']:,.2f}"]
                           for a in alerts]})


def alert_clear(j, m):
    with j.store.lock:
        j.store["alerts"] = []
        j.store.save()
    return Reply("All price alerts cleared.")


def check_alerts(j):
    """Fire any alert whose level has been crossed. Returns the messages."""
    alerts = list(j.store["alerts"])
    if not alerts:
        return []
    qs = market.quotes(a["symbol"] for a in alerts)
    fired, keep = [], []
    for a in alerts:
        q = qs.get(a["symbol"])
        hit = q and (q["price"] >= a["level"] if a["above"] else q["price"] <= a["level"])
        if hit:
            fired.append(f"Price alert. {q['name']} is at {market.price_text(q)}, "
                         f"{'above' if a['above'] else 'below'} your level of {a['level']:,.2f}.")
        else:
            keep.append(a)
    if fired:
        with j.store.lock:
            j.store["alerts"] = keep
            j.store.save()
        for msg in fired:
            j.notify(msg)
    return fired


def start_alert_thread(j):
    def loop():
        stop = threading.Event()
        while not stop.wait(max(15, j.cfg["alert_check_seconds"])):
            try:
                check_alerts(j)
            except Exception:  # never let the watcher die
                pass
    threading.Thread(target=loop, daemon=True, name="alerts").start()


def register(j):
    name = r"(?P<name>.+?)"
    at = r"(?:\s+(?:at|@|for)\s+" + PRICE + r"(?:\s*(?:rupees|rs|each|per share))*)?"
    j.on(r"\bimport (my )?(portfolio|holdings)\b", do_import)
    j.on(r"\b(?:i\s+)?(?P<side>bought|buy|purchased|sold|sell)\s+" + QTY +
         r"\s*(?:shares?|stocks?|units?|quantity)?\s*(?:of\s+)?" + name + at + r"$", do_trade)
    j.on(r"\b(?:remove|delete)\s+" + name + r"\s+from\s+(?:my\s+)?(?:portfolio|holdings)", remove_holding)
    j.on(r"\badd\s+" + name + r"\s+(?:to|in|on)\s+(?:my\s+|the\s+)?watch ?list", watch_add)
    j.on(r"\b(?:remove|delete)\s+" + name + r"\s+from\s+(?:my\s+|the\s+)?watch ?list", watch_remove)
    j.on(r"\bwatch ?list\b", watch_show)
    j.on(r"\b(?:alert|notify|tell|inform|remind)\s+me\s+(?:when|if|once)\s+" + name +
         r"\s+(?:goes|is|gets|falls|drops|rises|moves|trades|price is)?\s*"
         r"(?P<dir>above|below|over|under|crosses|exceeds|reaches|hits)\s+" + PRICE, alert_add)
    j.on(r"\b(clear|delete|remove|cancel)\s+(all\s+)?(my\s+)?(price\s+)?alerts\b", alert_clear)
    j.on(r"\b(my|show|list|any)\b.*\balerts\b", alert_show)
    j.on(r"\breali[sz]ed\b|\bbooked (profit|loss)", realised_pnl)
    j.on(r"\b(top|best|worst|biggest)\s+(gainers?|losers?|performers?|laggards?)", movers)
    j.on(r"\b(portfolio|holdings|my investments|net ?worth|p ?(&|and|n) ?l|profit (and|or) loss)\b", show_portfolio)
