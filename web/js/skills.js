/* Jarvis web — fast built-in commands. Anything these don't cover goes to the AI command engine (ai.js). */
"use strict";
(function (J) {
  const R = (speech, extra = {}) => Object.assign({ speech }, extra);
  const routes = [];
  const on = (re, fn) => routes.push([re, fn]);
  J.ctx = { lastApp: null, pending: null, lastTopic: "" };

  // ---------------- conversation basics
  const JOKES = ["Why did the investor bring a ladder to the exchange? Because the market was going through the roof.",
    "I asked the market for a sign. It gave me a candlestick.", "My to-do list and I have an understanding. I ignore it, and it grows.",
    "A bull, a bear and an analyst walk into a bar. Only the analyst predicted it afterwards."];
  on(/^(hi|hello|hey|namaste|good (morning|afternoon|evening)|are you there|wake up)$/i, () =>
    R(`${J.greeting()}${J.data.settings.name ? ", " + J.data.settings.name : ""}. I am ready. Would you like your daily briefing, your tasks, your email, or business mode?`,
      { ask: { yes: () => J.briefingReply() } }));
  on(/\b(thank you|thanks|well done|good job)\b/i, () => R("Always a pleasure."));
  on(/^(help|commands)$|what can you do|what are your (features|skills|commands)/i, () => R("Here is what I can do. The full list is on screen.", { view: "help" }));
  on(/\b(switch|change) to (friday|jarvis)\b/i, m => { J.data.settings.persona = /friday/i.test(m[0]) ? "friday" : "jarvis"; J.save("settings"); J.emit("persona");
    return R(`${J.data.settings.persona === "friday" ? "Friday" : "Jarvis"} online.`); });
  on(/\b(what(?:'s| is) the time|time is it|current time|^the time$)/i, () => R("The time is " + new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) + "."));
  on(/\b(what(?:'s| is) (the|today'?s) date|what day is it|today'?s date)\b/i, () => R("Today is " + new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + "."));
  on(/\b(who are you|your name|who (made|created|built) you)\b/i, () => R("I am Jarvis, your business assistant. I manage your tasks, calendar, email, content and investing desk, by voice or text."));
  on(/\bjoke\b|make me laugh/i, () => R(JOKES[Math.floor(Math.random() * JOKES.length)]));
  on(/^(stop|cancel|never ?mind|quiet|be quiet|shut up)$/i, () => { J.ctx.pending = null; J.voice.stopSpeaking(); return R("Okay."); });

  // ---------------- modes & workflows
  on(/\b(start|begin) (my )?(business )?(work|workday|work day|day)\b|\bbusiness mode\b|\bstart my business\b/i, () => J.runFlowReply("business"));
  on(/\bfocus mode\b|\b(start|begin) (a )?focus( session)?\b|\bproductivity mode\b/i, m => J.runFlowReply("focus", { minutes: J.num(m.input) || 25 }));
  on(/\bcontent mode\b/i, () => J.runFlowReply("content"));
  on(/\bresearch mode\b/i, () => J.runFlowReply("research"));
  on(/^(?:run|start|execute) (?:the |my )?(?:workflow |routine )?(?<name>.+?)(?: workflow| routine)?$/i, m => { const f = J.findFlow(m.groups.name); return f ? J.runFlowReply(f.id) : null; });
  on(/\b(daily )?briefing\b|\bbrief me\b|\bwhat should i focus on( today)?\b|\bmy day\b/i, () => J.briefingReply());

  // ---------------- launcher (with follow-up context: "open YouTube" then "search for …")
  on(/^(?:open|launch|go to|start|show me|take me to)\s+(?<name>.+)$/i, m => {
    const name = m.groups.name.replace(/[.?!]+$/, "");
    if (/business (applications|apps)|my (business )?apps/i.test(name)) {
      const apps = (J.data.settings.favorites || []).map(k => J.allApps().find(a => a.key === k)).filter(Boolean);
      return R(`Here are your business apps. Tap the ones you need.`, { links: apps.map(J.launchCard) });
    }
    if (/dashboard|home|jarvis/i.test(name)) return R("Here is your dashboard.", { view: "home" });
    if (/project folder|my folder|downloads|desktop|file explorer|explorer/i.test(name))
      return R("A web page can't open folders or programs on your computer. The Jarvis desktop app can: add the folder to its config.json and say “open my project folder” there. Your Google Drive is linked below.", { links: [{ label: "Open Google Drive", href: "https://drive.google.com" }] });
    const app = J.findApp(name);
    if (app) { J.ctx.lastApp = app.key; J.log("Launcher", "Open " + app.name);
      return R(`${app.name} is ready. Tap the button to open it.`, { links: [J.launchCard(app)], open: { url: app.url, name: app.name } }); }
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(name)) return R(`Here is ${name}.`, { links: [{ label: "Open " + name, href: "https://" + name }] });
    return null;   // let the AI decide (e.g. "open the marketing plan" → Drive search)
  });
  on(/^(?:search|look up|find)(?: for| about)? (?<q>.+?)(?: on (?<where>youtube|google|maps|news))?$/i, m => {
    const where = (m.groups.where || "").toLowerCase() || (["youtube", "maps", "news"].includes(J.ctx.lastApp) ? J.ctx.lastApp : "");
    if (!where && /\b(email|mail|inbox|drive|file|document|task)s?\b/i.test(m.groups.q)) return null;   // those are for the AI tools
    const app = J.findApp(where || "google"); const q = m.groups.q;
    J.ctx.lastTopic = q;
    return R(`Here are ${app.name} results for ${q}. Would you like a research summary as well?`, { links: [{ label: `${app.name}: ${q}`, href: app.search(q) }],
      ask: { yes: () => J.researchReply(q) } });
  });
  on(/\bplay (?<q>.+?)(?: on youtube)?$/i, m => R(`Here is ${m.groups.q} on YouTube.`, { links: [{ label: "YouTube: " + m.groups.q, href: J.findApp("youtube").search(m.groups.q) }] }));

  // ---------------- tasks & reminders
  on(/^(?:please )?remind me (?:to |about |that )?(?<t>.+)/i, m => {
    const t = J.taskFromSpeech(m.groups.t, { remind: true, source: "remind" });
    const when = t.due ? J.niceDate(t.due) : "";
    return R(`Okay. I'll remind you to ${t.title.toLowerCase()}${when ? ", " + when.toLowerCase() : ""}.` + (t.due && t.due.length > 10 ? " Reminders sound while Jarvis is open. Want it in Google Calendar too, so your phone reminds you?" : " Tell me a time if you'd like an alert."),
      { view: "tasks", ask: t.due && t.due.length > 10 ? { yes: () => J.calendarForTask(t) } : null });
  });
  on(/^(?:create|add|make|new) (?:a |an )?(?:new )?(?:task|to-?do|todo)(?: to| for| called| :)? (?<t>.+)|^add (?<t2>.+?) to (?:my |the )?(?:task|to-?do|todo)s?(?: list)?$/i, m => {
    const t = J.taskFromSpeech(m.groups.t || m.groups.t2);
    return R(`Task added: ${t.title}${t.due ? ", due " + J.niceDate(t.due).toLowerCase() : ""}${t.priority === "high" ? ", high priority" : ""}.`, { view: "tasks" });
  });
  on(/\b(?:what are |show |list |read )?(?:my )?(?:important |pending |open )?(?:tasks|to-?dos|todo list|to do list|pending work)(?: for)?(?<when> today| tomorrow| this week)?\??$/i, m => {
    const items = /tomorrow/.test(m.groups.when || "") ? J.sortedTasks(J.data.tasks.items.filter(t => !t.done && (t.due || "").slice(0, 10) === J.isoDate(new Date(Date.now() + 864e5))))
      : /today/.test(m.groups.when || "") ? J.tasksDue("today") : J.tasksDue("all");
    if (!items.length) return R("You have no open tasks" + (m.groups.when || "") + ". Say, for example: create a task to prepare the marketing campaign tomorrow.", { view: "tasks" });
    return R(`You have ${items.length} open task${items.length > 1 ? "s" : ""}${m.groups.when || ""}. ` + items.slice(0, 5).map((t, i) => `${i + 1}, ${t.title}${t.due ? ", " + J.niceDate(t.due).toLowerCase() : ""}`).join(". ") + ".", { view: "tasks" });
  });
  on(/^(?:mark |complete |finish(?:ed)? |done(?: with)? |tick off )(?:task |number )?(?<q>.+?)(?: as done| done| complete)?$/i, m => {
    const t = J.findTask(m.groups.q); if (!t) return R(`I couldn't find an open task matching ${m.groups.q}.`);
    J.completeTask(t); return R(`Marked done: ${t.title}.`);
  });

  // ---------------- memory (only with your consent)
  on(/\bremember (?:that )?(?<note>.+)/i, m => {
    if (!J.data.memory.enabled) return R("Long-term memory is off. Turn it on in Settings and I'll keep facts like that across sessions. For now I'll remember it until you close this page.",
      { remember: m.groups.note });
    J.data.memory.items.push({ id: J.uid(), text: m.groups.note, t: Date.now() }); J.save("memory"); J.log("Memory saved", m.groups.note);
    return R(`I'll remember that ${m.groups.note}.`);
  });
  on(/\b(what do you remember|do you remember anything|what do you know about me)\b/i, () => {
    const items = J.data.memory.items.concat(J.data.memory.notes.map(n => ({ text: n.text })));
    return items.length ? R("Here is what I remember: " + items.slice(-6).map(i => i.text).join(". ") + ".", { view: "prefs" }) : R("I haven't saved anything about you yet.");
  });

  // ---------------- investing desk (from the first version)
  const ALIASES = { "nifty": "NIFTY", "nifty 50": "NIFTY", "sensex": "SENSEX", "bank nifty": "BANKNIFTY", "reliance": "RELIANCE", "tcs": "TCS", "infosys": "INFY", "infy": "INFY",
    "hdfc bank": "HDFCBANK", "icici bank": "ICICIBANK", "sbi": "SBIN", "state bank": "SBIN", "axis bank": "AXISBANK", "kotak": "KOTAKBANK", "kotak bank": "KOTAKBANK",
    "itc": "ITC", "l&t": "LT", "larsen": "LT", "wipro": "WIPRO", "hcl": "HCLTECH", "hcl tech": "HCLTECH", "airtel": "BHARTIARTL", "bharti airtel": "BHARTIARTL",
    "maruti": "MARUTI", "tata motors": "TATAMOTORS", "tata steel": "TATASTEEL", "tata power": "TATAPOWER", "bajaj finance": "BAJFINANCE", "asian paints": "ASIANPAINT",
    "titan": "TITAN", "hul": "HINDUNILVR", "hindustan unilever": "HINDUNILVR", "sun pharma": "SUNPHARMA", "dr reddy": "DRREDDY", "dr reddys": "DRREDDY", "cipla": "CIPLA",
    "lupin": "LUPIN", "divis": "DIVISLAB", "biocon": "BIOCON", "zydus": "ZYDUSLIFE", "adani enterprises": "ADANIENT", "adani ports": "ADANIPORTS", "ongc": "ONGC",
    "ntpc": "NTPC", "power grid": "POWERGRID", "coal india": "COALINDIA", "zomato": "ETERNAL", "eternal": "ETERNAL", "paytm": "PAYTM", "lic": "LICI", "irctc": "IRCTC",
    "apollo hospitals": "APOLLOHOSP", "mankind": "MANKIND", "torrent pharma": "TORNTPHARM", "alkem": "ALKEM", "glenmark": "GLENMARK", "anupam rasayan": "ANURAS" };
  const NOISE = /\b(the|a|an|stock|stocks|share|shares|price|of|for|company|ltd|limited|today|now|please|my)\b/g;
  J.sym = name => { const k = String(name).toLowerCase().replace(NOISE, " ").replace(/[^a-z0-9&\- ]/g, " ").replace(/\s+/g, " ").trim();
    return k ? ALIASES[k] || k.replace(/[^a-z0-9&\-]/g, "").toUpperCase() : null; };
  const tvSym = s => s === "NIFTY" ? "NSE:NIFTY" : s === "SENSEX" ? "BSE:SENSEX" : s === "BANKNIFTY" ? "NSE:BANKNIFTY" : "NSE:" + s;
  J.LINK = {
    chart: s => ({ label: "Chart on TradingView", href: "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(tvSym(s)) }),
    screener: s => ({ label: "Fundamentals on Screener", href: "https://www.screener.in/company/" + encodeURIComponent(s) + "/" }),
    quote: s => ({ label: "Live quote: " + s, href: "https://www.google.com/finance/quote/" + encodeURIComponent(s === "NIFTY" ? "NIFTY_50:INDEXNSE" : s === "SENSEX" ? "SENSEX:INDEXBOM" : s + ":NSE") }),
  };
  const S = () => J.data.state;
  J.ltpOf = s => { const p = S().prices[s]; return p ? p.price : (S().portfolio[s] ? S().portfolio[s].avg : null); };
  J.snapshot = () => {
    const rows = Object.entries(S().portfolio).map(([s, h]) => { const ltp = J.ltpOf(s), inv = h.qty * h.avg, val = h.qty * ltp;
      return { s, qty: h.qty, avg: h.avg, ltp, at: S().prices[s] ? S().prices[s].at : null, inv, val, pnl: val - inv, pnlPct: inv ? (val - inv) / inv * 100 : 0 }; });
    rows.sort((a, b) => b.val - a.val);
    const inv = rows.reduce((a, r) => a + r.inv, 0), val = rows.reduce((a, r) => a + r.val, 0);
    return { rows, inv, val, pnl: val - inv, pnlPct: inv ? (val - inv) / inv * 100 : 0 };
  };
  J.holdingsPanel = snap => ({ title: "Portfolio", columns: ["Stock", "Qty", "Avg", "Last price", "Value", "P&L", "P&L %"],
    rows: snap.rows.map(r => [r.s, String(+r.qty.toFixed(4)), J.money(r.avg), J.money(r.ltp), J.money(r.val, 0), J.money(r.pnl, 0), J.pct(r.pnlPct)])
      .concat([["TOTAL", "", "", "", J.money(snap.val, 0), J.money(snap.pnl, 0), J.pct(snap.pnlPct)]]) });
  function trade(s, qty, price, side) {
    const h = S().portfolio[s] || { qty: 0, avg: 0 };
    if (side === "buy") { h.avg = (h.qty * h.avg + qty * price) / (h.qty + qty); h.qty += qty; S().portfolio[s] = h; if (!S().prices[s]) S().prices[s] = { price, at: J.today() }; J.save("state"); return null; }
    if (qty > h.qty + 1e-9) throw new Error(`you only hold ${h.qty} of ${s}`);
    const r = (price - h.avg) * qty; h.qty -= qty;
    S().realised.push({ date: J.today(), s, qty, price, pnl: Math.round(r * 100) / 100 });
    if (h.qty <= 1e-9) delete S().portfolio[s]; else S().portfolio[s] = h;
    S().prices[s] = { price, at: J.today() }; J.save("state"); return r;
  }
  const NAME = "(?<name>.+?)", PRICE = "(?:rs\\.?|rupees|inr|₹)?\\s*(?<price>\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:k|thousand|lakhs?|lacs?|crores?|cr)\\b)?)";
  on(new RegExp(`\\b(?:i\\s+)?(?<side>bought|buy|purchased|sold|sell)\\s+(?<qty>\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:shares?|stocks?|units?)?\\s*(?:of\\s+)?${NAME}(?:\\s+(?:at|@|for)\\s+${PRICE}(?:\\s*(?:rupees|rs|each|per share))*)?$`, "i"), m => {
    const side = /^s/i.test(m.groups.side) ? "sell" : "buy", s = J.sym(m.groups.name), qty = J.num(m.groups.qty), price = m.groups.price ? J.num(m.groups.price) : null;
    if (price == null) return R(`At what price? Say, for example: ${side === "buy" ? "bought" : "sold"} ${qty} ${m.groups.name} at 2900.`);
    let r; try { r = trade(s, qty, price, side); } catch (e) { return R(`I cannot record that sale, ${e.message}.`); }
    J.log("Portfolio", `${side === "buy" ? "Bought" : "Sold"} ${qty} ${s} at ${J.money(price)}`); J.emit("portfolio");
    if (side === "buy") { const h = S().portfolio[s]; return R(`Recorded. Bought ${qty} ${s} at ${J.money(price)}. You now hold ${+h.qty.toFixed(4)} at an average of ${J.money(h.avg)}.`, { view: "invest" }); }
    return R(`Recorded. Sold ${qty} ${s} at ${J.money(price)}, realised ${r >= 0 ? "profit" : "loss"} of ${J.money(Math.abs(r), 0)}.`, { view: "invest" });
  });
  on(new RegExp(`^(?:update (?:the )?(?:price|rate) of |set (?:the )?price of )?${NAME}\\s+(?:is|is at|is now|at|trading at|to|=)\\s+${PRICE}$`, "i"), m => {
    const s = J.sym(m.groups.name); if (!s || s.length > 14) return null;
    S().prices[s] = { price: J.num(m.groups.price), at: J.today() }; J.save("state"); J.emit("portfolio");
    const h = S().portfolio[s]; if (!h) return R(`Noted. ${s} at ${J.money(S().prices[s].price)}.`);
    const p = (S().prices[s].price - h.avg) / h.avg * 100;
    return R(`Updated. ${s} at ${J.money(S().prices[s].price)}. Your ${+h.qty.toFixed(4)} shares are ${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(1)} percent on cost.`);
  });
  on(new RegExp(`\\b(?:remove|delete)\\s+${NAME}\\s+from\\s+(?:my\\s+)?(?:portfolio|holdings)`, "i"), m => { const s = J.sym(m.groups.name);
    if (!S().portfolio[s]) return R(`${m.groups.name} is not in your portfolio.`); delete S().portfolio[s]; J.save("state"); J.emit("portfolio"); J.log("Portfolio", "Removed " + s); return R(`Removed ${s} from your portfolio.`); });
  on(/\breali[sz]ed\b|\bbooked (profit|loss)/i, () => { const items = S().realised; if (!items.length) return R("No sales recorded yet, so there is no realised profit or loss.");
    const t = items.reduce((a, i) => a + i.pnl, 0);
    return R(`Realised ${t >= 0 ? "profit" : "loss"} so far is ${J.money(Math.abs(t), 0)} across ${items.length} sale${items.length > 1 ? "s" : ""}.`,
      { panel: { title: "Realised P&L", columns: ["Date", "Stock", "Qty", "Price", "P&L"], rows: items.slice(-15).map(i => [i.date, i.s, String(i.qty), J.money(i.price), J.money(i.pnl, 0)]) } }); });
  on(new RegExp(`\\badd\\s+${NAME}\\s+(?:to|in|on)\\s+(?:my\\s+|the\\s+)?watch ?list`, "i"), m => { const s = J.sym(m.groups.name);
    if (!S().watchlist.includes(s)) { S().watchlist.push(s); J.save("state"); J.emit("portfolio"); } return R(`Added ${s} to your watchlist.`); });
  on(new RegExp(`\\b(?:remove|delete)\\s+${NAME}\\s+from\\s+(?:my\\s+|the\\s+)?watch ?list`, "i"), m => { const s = J.sym(m.groups.name), i = S().watchlist.indexOf(s);
    if (i < 0) return R(`${m.groups.name} is not on your watchlist.`); S().watchlist.splice(i, 1); J.save("state"); J.emit("portfolio"); return R(`Removed ${s} from your watchlist.`); });
  on(/\bwatch ?list\b/i, () => S().watchlist.length ? R(`Your watchlist has ${S().watchlist.join(", ")}. Live quotes are linked below.`, { links: S().watchlist.slice(0, 6).map(J.LINK.quote) })
    : R("Your watchlist is empty. Say: add Infosys to my watchlist."));
  on(/\b(portfolio|holdings|my investments|net ?worth)\b/i, m => {
    if (/\b(analy[sz]e|risk|should|advice|suggest|review|rebalanc|diversif)/i.test(m.input)) return null;
    const snap = J.snapshot(); if (!snap.rows.length) return R("Your portfolio is empty. Say, for example: I bought 10 shares of Reliance at 2900.", { view: "invest" });
    let sp = `Your portfolio is worth ${J.money(snap.val, 0)}, ${snap.pnl >= 0 ? "a gain" : "a loss"} of ${J.money(Math.abs(snap.pnl), 0)}, that is ${Math.abs(snap.pnlPct).toFixed(1)} percent.`;
    const old = snap.rows.filter(r => r.at && r.at < J.today()).length; if (old) sp += ` ${old} of these prices are from an earlier day.`;
    return R(sp, { panel: J.holdingsPanel(snap) });
  });
  on(/\b(?<kind>chart|fundamentals|screener|financials)\s+(?:of|for)\s+(?<name>.+)/i, m => { const s = J.sym(m.groups.name);
    return R(`Here is ${/chart/i.test(m.groups.kind) ? "the chart" : "the fundamentals page"} for ${s}.`, { links: [/chart/i.test(m.groups.kind) ? J.LINK.chart(s) : J.LINK.screener(s)] }); });
  on(/\b(?:price|quote)\s+(?:of|for)\s+(?<name>.+)|^(?:what(?:'s| is)\s+)?(?<name2>.+?)\s+(?:share|stock)s?\s*(?:price|rate|quote)$/i, m => {
    const s = J.sym(m.groups.name || m.groups.name2), p = S().prices[s];
    return R(`${p ? `The last price you gave me for ${s} was ${J.money(p.price)} on ${p.at}.` : `I don't have a price for ${s} yet.`} I can't read live exchange data in the web version, so here is the live quote.`, { links: [J.LINK.quote(s), J.LINK.chart(s)] }); });
  on(/\b(market (update|summary|status|today)|how(?:'s| is| are) the markets?)\b/i, () => R("I can't read live exchange data in the web version. Here are the live market screens.",
    { links: [J.LINK.quote("NIFTY"), J.LINK.quote("SENSEX"), { label: "Market news", href: J.findApp("news").url }] }));

  // ---------------- calculators
  function terms(t, def = 12) { t = t.toLowerCase(); let years = null, rate = null, m;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/))) { years = +m[1]; t = t.replace(m[0], " "); }
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)/))) { rate = +m[1]; t = t.replace(m[0], " "); }
    return { amount: J.num(t), years, rate: rate == null ? def : rate }; }
  J.sipValue = (m, y, r) => { const i = r / 1200, n = Math.round(y * 12); return i === 0 ? m * n : m * ((1 + i) ** n - 1) / i * (1 + i); };
  on(/\bcagr\b|compound(ed)? annual growth/i, m => { const n = [...m.input.toLowerCase().matchAll(new RegExp(J.NUM.source, "g"))].map(x => parseFloat(x[1].replace(/,/g, "")) * (J.UNITS[x[2] || ""] || 1));
    if (n.length < 3 || n[0] <= 0 || n[2] <= 0) return R("Say it like this: CAGR from 100 to 250 in 5 years.");
    return R(`Growing from ${n[0].toLocaleString("en-IN")} to ${n[1].toLocaleString("en-IN")} in ${n[2]} years is a CAGR of ${(((n[1] / n[0]) ** (1 / n[2]) - 1) * 100).toFixed(2)} percent.`); });
  on(/\b(sip|systematic investment|monthly investment)\b/i, m => { const { amount, years, rate } = terms(m.input);
    if (!amount || !years) return R("Tell me the amount and period, for example: SIP of 10,000 a month for 15 years at 12 percent.");
    const fv = J.sipValue(amount, years, rate), inv = amount * years * 12;
    return R(`A monthly SIP of ${J.money(amount, 0)} for ${years} years at ${rate} percent grows to about ${J.spoken(fv)}. You invest ${J.spoken(inv)} and earn ${J.spoken(fv - inv)}.`,
      { panel: { title: "SIP projection", columns: ["", ""], rows: [["Monthly investment", J.money(amount, 0)], ["Period", `${years} years`], ["Assumed return", `${rate}% a year`],
        ["Total invested", J.money(inv, 0)], ["Estimated gains", J.money(fv - inv, 0)], ["Future value", J.money(fv, 0)]] } }); });
  on(/\b(lump ?sum|one[- ]time investment)\b/i, m => { const { amount, years, rate } = terms(m.input);
    if (!amount || !years) return R("Tell me the amount and period, for example: lump sum of 5 lakh for 10 years at 12 percent.");
    const fv = amount * (1 + rate / 100) ** years;
    return R(`${J.spoken(amount)} invested for ${years} years at ${rate} percent grows to about ${J.spoken(fv)}, which is ${(fv / amount).toFixed(1)} times your money.`); });

  // ---------------- router
  J.cleanInput = text => {
    let q = String(text).trim().replace(/^(?:(?:hey|ok|okay)\s+)?(jarvis|friday)\b[\s,.!]*/i, "").replace(/[\s,]+(jarvis|friday)[.!?\s]*$/i, "").replace(/[.!?,\s]+$/, "");
    const rest = q.match(/^(?:hi|hello|hey|namaste|good (?:morning|afternoon|evening))[\s,.!]+(?:(?:jarvis|friday)[\s,.!]+)?(.{3,})$/i);
    return rest ? rest[1].replace(/[.!?,\s]+$/, "") : q;
  };
  const YES = /^(yes|yeah|yep|sure|ok(ay)?|please|go ahead|do it|haan|ha|ji|ji haan|theek hai|why not|yes please)\b/i, NO = /^(no|nope|nah|not now|later|nahi|na|skip)\b/i;
  J.route = async text => {
    const q = J.cleanInput(text);
    if (!q) return R("Yes?");
    if (J.ctx.pending && (YES.test(q) || NO.test(q))) {
      const p = J.ctx.pending; J.ctx.pending = null;
      if (NO.test(q)) return p.no ? p.no() : R("Okay.");
      return p.yes();
    }
    J.ctx.pending = null;
    for (const [re, fn] of routes) { const m = q.match(re); if (!m) continue; m.input = q; const out = await fn(m); if (out) return out; }
    return null;  // not a built-in command
  };
})(window.J);
