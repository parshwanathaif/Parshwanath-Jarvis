/* Jarvis web — core: helpers, persistent store, activity log, event bus. */
"use strict";
window.J = window.J || {};
(function (J) {
  J.$ = id => document.getElementById(id);
  J.el = (tag, text, cls, attrs) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  J.wait = ms => new Promise(r => setTimeout(r, ms));
  J.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  J.today = () => J.isoDate(new Date());
  J.isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  J.localIso = d => `${J.isoDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
  J.niceDate = iso => {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso), t = J.today();
    const day = iso.slice(0, 10) === t ? "Today" : iso.slice(0, 10) === J.isoDate(new Date(Date.now() + 864e5)) ? "Tomorrow"
      : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    return iso.length > 10 ? `${day}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : day;
  };
  J.greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

  // money, numbers (Indian conventions)
  const groupIN = n => { const s = String(n); if (s.length <= 3) return s; let head = s.slice(0, -3); const tail = s.slice(-3), parts = [];
    while (head.length > 2) { parts.unshift(head.slice(-2)); head = head.slice(0, -2); } if (head) parts.unshift(head); return parts.join(",") + "," + tail; };
  J.money = (v, dec = 2) => { if (v == null || isNaN(v)) return "n/a"; const sign = v < 0 ? "-" : ""; const [w, f] = Math.abs(v).toFixed(dec).split(".");
    return sign + "₹" + groupIN(w) + (dec ? "." + f : ""); };
  J.spoken = v => { const a = Math.abs(v), s = v < 0 ? "minus " : "";
    return a >= 1e7 ? `${s}${(a / 1e7).toFixed(2)} crore rupees` : a >= 1e5 ? `${s}${(a / 1e5).toFixed(2)} lakh rupees` : `${s}${Math.round(a).toLocaleString("en-IN")} rupees`; };
  J.pct = v => v == null || isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  J.UNITS = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, million: 1e6, billion: 1e9 };
  J.NUM = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr|million|billion)?\b/;
  J.num = t => { const m = String(t).toLowerCase().match(J.NUM); return m ? parseFloat(m[1].replace(/,/g, "")) * (J.UNITS[m[2] || ""] || 1) : null; };

  // ---- event bus
  const subs = {};
  J.on = (ev, fn) => (subs[ev] = subs[ev] || []).push(fn);
  J.emit = (ev, data) => (subs[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  // ---- persistent store: one document per area, kept in the viewer's Claude account (private), mirrored on this device
  const DEFAULTS = {
    state: { portfolio: {}, watchlist: [], realised: [], prices: {} },
    tasks: { items: [] },
    content: { items: [] },
    flows: { custom: [], runs: [] },
    activity: { items: [] },
    memory: { enabled: false, items: [], notes: [] },
    settings: { name: "", engine: "", rate: 1, voiceName: "", language: "", favorites: ["gmail", "whatsapp", "instagram", "youtube", "linkedin", "calendar"],
                shortcuts: [], recent: [], autoBriefing: true, lastBriefing: "" },
  };
  J.data = JSON.parse(JSON.stringify(DEFAULTS));
  J.storage = "device";
  const refs = {}, timers = {};
  const lsKey = n => "jarvis2-" + n;
  function merge(name, v) { J.data[name] = Object.assign(JSON.parse(JSON.stringify(DEFAULTS[name])), v || {}); }

  J.save = name => {
    try { localStorage.setItem(lsKey(name), JSON.stringify(J.data[name])); } catch (_) {}
    if (!refs[name]) return;
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => refs[name].set({ v: JSON.stringify(J.data[name]), updated: Date.now() })
      .catch(() => J.toast("Couldn't save to your account just now. Kept on this device.", "bad")), 700);
  };

  J.initStore = async () => {
    for (const n in DEFAULTS) { try { const v = JSON.parse(localStorage.getItem(lsKey(n)) || "null"); if (v) merge(n, v); } catch (_) {} }
    // carry over data from the first web version (portfolio, notes, to-dos)
    try {
      const old = JSON.parse(localStorage.getItem("jarvis-state-v1") || "null");
      if (old && !localStorage.getItem(lsKey("migrated"))) migrateV1(old);
    } catch (_) {}
    J.emit("data");
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    const id = user ? await user.id() : null;
    if (!db || !id) { J.emit("storage", "device"); return; }
    const base = "data/users/" + id + "/";
    const timeout = setTimeout(() => J.emit("storage", "slow"), 10000);
    try {
      const v1 = await db.doc(base + "state").get();                 // first web version kept everything here
      for (const n in DEFAULTS) {
        refs[n] = db.doc(base + (n === "state" ? "investing" : n));
        const snap = await refs[n].get(), d = snap.data();
        if (d && d.v) { merge(n, JSON.parse(d.v)); try { localStorage.setItem(lsKey(n), d.v); } catch (_) {} }
        else J.save(n);                                                 // first time on this account: keep what this device has
      }
      const old = v1.data();
      if (old && old.state && !J.data.settings.migratedV1) { migrateV1(JSON.parse(old.state)); J.data.settings.migratedV1 = true; J.save("settings"); }
      clearTimeout(timeout);
      J.storage = "account"; J.emit("storage", "account"); J.emit("data");
    } catch (e) { clearTimeout(timeout); for (const n in refs) delete refs[n]; J.emit("storage", "device"); }
  };
  function migrateV1(old) {
    const s = J.data.state;
    if (old.portfolio && !Object.keys(s.portfolio).length) Object.assign(s, { portfolio: old.portfolio, watchlist: old.watchlist || [], realised: old.realised || [], prices: old.prices || {} });
    for (const t of old.todos || []) J.data.tasks.items.push({ id: J.uid(), title: t, priority: "medium", done: false, created: Date.now() });
    for (const n of old.notes || []) J.data.memory.notes.push(n);
    ["state", "tasks", "memory"].forEach(J.save);
    try { localStorage.setItem(lsKey("migrated"), "1"); } catch (_) {}
  }

  J.wipe = async name => { merge(name, null); J.save(name); J.emit("data"); };

  // ---- activity log: every action Jarvis takes, with its status
  J.log = (action, detail, status = "done", extra = {}) => {
    const item = Object.assign({ id: J.uid(), t: Date.now(), action, detail: String(detail || "").slice(0, 300), status }, extra);
    const a = J.data.activity.items; a.unshift(item); if (a.length > 300) a.length = 300;
    J.save("activity"); J.emit("activity", item); return item;
  };
  J.setStatus = (item, status, detail) => { item.status = status; if (detail != null) item.detail = String(detail).slice(0, 300); J.save("activity"); J.emit("activity", item); };

  // ---- toasts
  J.toast = (text, kind = "") => {
    const t = J.el("div", text, "toast " + kind, { role: "status" });
    J.$("toasts").append(t); setTimeout(() => t.remove(), 6000);
  };

  // ---- tables
  const NUMERIC = /^[\s₹$+\-\d.,%n/a:]*$/;
  J.table = (panel) => {
    const wrap = J.el("div", null, "tablewrap"), t = J.el("table");
    const numeric = panel.columns.map((_, i) => i > 0 && panel.rows.every(r => NUMERIC.test(String(r[i] ?? ""))));
    if (panel.columns.some(c => c)) { const tr = J.el("tr"); panel.columns.forEach((c, i) => tr.append(J.el("th", c, numeric[i] ? "num" : ""))); t.append(tr); }
    for (const row of panel.rows) {
      const tr = J.el("tr", null, row[0] === "TOTAL" ? "total" : "");
      row.forEach((c, i) => {
        const td = J.el("td", null, numeric[i] ? "num" : "");
        if (c && typeof c === "object" && c.href) { const a = J.el("a", c.text, "", { href: c.href, target: "_blank", rel: "noopener" }); td.append(a); }
        else { td.textContent = c; if (numeric[i] && /^[+-]/.test(c)) td.classList.add(c[0] === "+" ? "up" : "down"); }
        tr.append(td);
      });
      t.append(tr);
    }
    wrap.append(t); return wrap;
  };
  J.linkBtn = (label, href) => J.el("a", label + " ↗", "go", { href, target: "_blank", rel: "noopener" });
  J.copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1500); } }
    catch (_) { J.toast("Copy isn't allowed here. Select the text and press Ctrl+C.", "bad"); }
  };
})(window.J);
