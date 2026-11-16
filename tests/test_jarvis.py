import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["JARVIS_NO_BROWSER"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)

from jarvis.config import Store, load_config  # noqa: E402
from jarvis.core import Jarvis  # noqa: E402
from jarvis.skills import calc, portfolio  # noqa: E402
from jarvis.util import money, parse_number, spoken_inr  # noqa: E402
from tests import fakes  # noqa: E402

fakes.install()


def new_jarvis():
    path = os.path.join(tempfile.mkdtemp(), "state.json")
    return Jarvis(load_config("/no/such/config.json"), Store(path))


class Util(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(parse_number("2,900 rupees"), 2900)
        self.assertEqual(parse_number("5 lakh"), 500000)
        self.assertEqual(parse_number("1.5 crore"), 15000000)
        self.assertIsNone(parse_number("nothing"))

    def test_money(self):
        self.assertEqual(money(1234567.5), "₹12,34,567.50")
        self.assertEqual(money(-950, decimals=0), "-₹950")
        self.assertEqual(money(1234567.5, "USD"), "$1,234,567.50")
        self.assertEqual(spoken_inr(5046000), "50.46 lakh rupees")

    def test_sip(self):
        self.assertAlmostEqual(calc.sip_value(10000, 15, 12), 5045760, delta=5)
        self.assertEqual(calc.sip_value(1000, 1, 0), 12000)


class Commands(unittest.TestCase):
    def setUp(self):
        self.j = new_jarvis()

    def say(self, text):
        return self.j.handle(text)

    def test_basics(self):
        self.assertIn("at your service", self.say("Hey Jarvis, hello")["speech"])
        self.assertIn("The time is", self.say("jarvis what time is it")["speech"])
        self.assertEqual(self.say("switch to friday")["voice"], "female")
        self.assertTrue(self.say("go to sleep")["sleep"])
        self.assertEqual(len(self.say("help")["panel"]["rows"]), 9)

    def test_quote(self):
        r = self.say("what is the price of Reliance")
        self.assertIn("₹2,958.00", r["speech"])
        self.assertIn("up 2.00 percent", r["speech"])  # vs yesterday's close, not the 5-day-old one
        self.assertIn("down 2.00 percent", self.say("how is TCS doing today")["speech"])
        self.assertIn("25,250.00", self.say("nifty share price")["speech"])
        self.assertIn("could not find", self.say("price of zzzzqq")["speech"])

    def test_symbol_search_prefers_nse(self):
        self.j.store["symbols"].clear()
        from jarvis.skills import market
        market.ALIASES.pop("cipla")
        try:
            self.assertEqual(market.resolve(self.j, "Cipla"), "CIPLA.NS")
        finally:
            market.ALIASES["cipla"] = "CIPLA.NS"

    def test_market_update(self):
        r = self.say("market update")
        self.assertIn("Nifty 50 is at 25,250, up 1.00 percent", r["speech"])
        self.assertEqual(len(r["panel"]["rows"]), 6)

    def test_portfolio_flow(self):
        self.assertIn("empty", self.say("how is my portfolio")["speech"])
        self.assertIn("Bought 10 RELIANCE", self.say("I bought 10 shares of Reliance at 2,800 rupees")["speech"])
        r = self.say("buy 10 reliance at 3000")
        self.assertIn("hold 20 at an average of ₹2,900.00", r["speech"])
        self.say("bought 5 TCS at 4000")
        r = self.say("how is my portfolio")
        # value = 20*2958 + 5*4018 = 79250 ; cost = 58000 + 20000 = 78000 ; day = 20*58 - 5*82 = 750
        self.assertIn("worth ₹79,250", r["speech"])
        self.assertIn("gain of ₹1,250", r["speech"])
        self.assertIn("up ₹750", r["speech"])
        self.assertEqual(r["panel"]["rows"][-1][0], "TOTAL")
        r = self.say("sold 5 reliance at 3100")
        self.assertIn("profit of ₹1,000", r["speech"])
        self.assertIn("only hold", self.say("sell 100 tcs at 4000")["speech"])
        self.assertIn("₹1,000", self.say("what is my realised profit")["speech"])
        self.assertIn("Reliance", self.say("top gainers")["speech"])
        self.say("remove tcs from my portfolio")
        self.assertNotIn("TCS.NS", self.j.store["portfolio"])
        # state survives a restart
        again = Jarvis(self.j.cfg, Store(self.j.store.path))
        self.assertEqual(again.store["portfolio"]["RELIANCE.NS"]["qty"], 15)

    def test_buy_at_market_price(self):
        self.assertIn("at ₹2,958.00", self.say("bought 2 reliance")["speech"])

    def test_csv_import(self):
        path = os.path.join(tempfile.mkdtemp(), "portfolio.csv")
        with open(path, "w") as f:
            f.write("symbol,qty,avg_price\nReliance,10,2500\nTCS.NS,4,3900\n")
        self.assertEqual(portfolio.import_csv(self.j, path), 2)
        self.assertEqual(self.j.store["portfolio"]["TCS.NS"], {"qty": 4, "avg": 3900})

    def test_watchlist_and_alerts(self):
        self.say("add cipla to my watchlist")
        self.assertEqual(self.j.store["watchlist"], ["CIPLA.NS"])
        self.assertIn("Cipla", self.say("show my watchlist")["speech"])
        self.say("remove cipla from watchlist")
        self.assertEqual(self.j.store["watchlist"], [])
        self.say("alert me when nifty goes above 25,200")
        self.say("alert me if reliance falls below 2500")
        self.assertEqual(len(self.say("show my alerts")["panel"]["rows"]), 2)
        fired = portfolio.check_alerts(self.j)
        self.assertEqual(len(fired), 1)
        self.assertIn("Nifty 50", self.j.notifications.get_nowait())
        self.assertEqual(len(self.j.store["alerts"]), 1)  # the untriggered one stays
        self.say("clear all alerts")
        self.assertEqual(self.j.store["alerts"], [])

    def test_calculators(self):
        self.assertIn("50.46 lakh", self.say("SIP of 10,000 a month for 15 years at 12 percent")["speech"])
        self.assertIn("15.53 lakh", self.say("lump sum of 5 lakh for 10 years at 12%")["speech"])
        self.assertIn("20.11 percent", self.say("cagr from 100 to 250 in 5 years")["speech"])
        self.assertIn("₹44,100.00", self.say("convert 500 dollars to rupees")["speech"])

    def test_information(self):
        self.assertIn("31 degrees with partly cloudy", self.say("what's the weather in Mumbai")["speech"])
        r = self.say("business news")
        self.assertIn("Sensex ends higher on pharma rally", r["speech"])
        self.assertEqual(r["panel"]["rows"][0][1], "Mint")
        self.assertIn("American investor", self.say("who is Warren Buffett")["speech"])
        self.assertIn("noun", self.say("meaning of arbitrage")["speech"])

    def test_browser_actions(self):
        for text in ("open zerodha", "play lofi on youtube", "search for best ELSS funds", "chart of reliance",
                     "fundamentals of tcs", "show nariman point on map", "open moneycontrol.com"):
            self.say(text)
        self.assertEqual(self.j.opened, [
            "https://kite.zerodha.com", "https://www.youtube.com/results?search_query=lofi",
            "https://www.google.com/search?q=best+ELSS+funds", "https://www.tradingview.com/chart/?symbol=NSE:RELIANCE",
            "https://www.screener.in/company/TCS/", "https://www.google.com/maps/search/nariman+point",
            "https://moneycontrol.com"])

    def test_memory(self):
        self.say("remember that the AGM is on Friday")
        self.assertIn("the AGM is on Friday", self.say("what do you remember")["speech"])
        self.say("add call the auditor to my to-do list")
        self.say("add review Q2 results to my todo list")
        self.assertIn("2 tasks", self.say("show my to-do list")["speech"])
        self.say("delete task 1")
        self.assertEqual(self.j.store["todos"], ["review Q2 results"])

    def test_connections_and_email_setup(self):
        self.j.cfg["connections"] = {"trading terminal": {"type": "url", "target": "https://t.example", "say": "Terminal up."}}
        self.assertEqual(self.say("open trading terminal")["speech"], "Terminal up.")
        self.assertEqual(self.j.opened, ["https://t.example"])
        self.assertIn("do not have an email address", self.say("send email to Rahul saying report is ready")["speech"])

    def test_unknown_and_errors(self):
        self.assertIn("do not have a built-in answer", self.say("xyzzy plugh")["speech"])
        self.assertIn("Yes", self.say("jarvis")["speech"])


class Server(unittest.TestCase):
    def test_api(self):
        from jarvis.server import serve
        j = new_jarvis()
        httpd = serve(j, 0)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}"

        def call(path, body=None, headers=None):
            req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None,
                                         headers=headers if headers is not None else {"X-Jarvis": "1"})
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.read().decode()

        try:
            self.assertIn("J.A.R.V.I.S", call("/"))
            self.assertIn("₹2,958.00", json.loads(call("/api/command", {"text": "price of reliance"}))["speech"])
            self.assertEqual(len(json.loads(call("/api/dashboard"))["ticker"]), 6)
            self.assertEqual(json.loads(call("/api/poll")), {"notifications": []})
            with self.assertRaises(urllib.error.HTTPError):  # other websites cannot drive Jarvis
                call("/api/command", {"text": "open zerodha"}, headers={})
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
