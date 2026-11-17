/* Jarvis web — integrations: Google connectors through Claude, platform registry, app launcher. */
"use strict";
(function (J) {
  // ---- Claude connectors (Gmail, Google Calendar, Google Drive). Calls run as the viewer; tokens never reach this page.
  let mcp = null;
  J.conn = {
    gmail: { name: "Gmail", server: "Gmail", status: "checking", detail: "", lastSync: 0 },
    calendar: { name: "Google Calendar", server: "Google Calendar", status: "checking", detail: "", lastSync: 0 },
    drive: { name: "Google Drive", server: "Google Drive", status: "checking", detail: "", lastSync: 0 },
  };
  const ERR = {
    needs_reauth: "Sign-in expired. Reconnect it in claude.ai → Settings → Connectors.",
    server_not_connected: "Not connected to your Claude account. Connect it in claude.ai → Settings → Connectors.",
    consent_required: "Not allowed for this page yet. Approve the request, or allow it from the page's Permissions menu.",
    not_granted: "Connectors aren't allowed in this view. Open Jarvis on claude.ai while signed in.",
    capability_disabled: "Connectors are switched off for this page.",
    blocked_by_policy: "Blocked by your organisation's policy.",
    approval_required: "Needs your approval in the dialog that opened.",
    server_unavailable: "The service is not responding. Try again in a minute.",
    upstream_error: "The service returned an error. Try again in a minute.",
    tool_error: "The service rejected the request.",
    selection_required: "You have more than one account for this connector. Pick one in the dialog.",
  };
  J.connError = e => (e && ERR[e.code]) || ((e && e.message) || "Unknown error");

  J.initConnectors = async () => {
    mcp = window.claude && window.claude.use ? await window.claude.use("mcp") : null;
    for (const k in J.conn) {
      J.conn[k].status = mcp ? "ready" : "unavailable";
      J.conn[k].detail = mcp ? "Connected through your Claude account. First use asks your permission." : "Not available in this view.";
    }
    J.emit("connections");
  };
  async function call(key, tool, input) {
    const c = J.conn[key];
    if (!mcp) throw new Error(c.name + " is not available in this view.");
    try {
      const r = await mcp.callTool(c.server, tool, input);
      c.status = "connected"; c.detail = "Working"; c.lastSync = Date.now(); J.emit("connections");
      return r.payload !== undefined ? r.payload : r;
    } catch (e) {
      const msg = J.connError(e);
      c.status = ["needs_reauth", "server_not_connected"].includes(e && e.code) ? "auth" : (e && e.code === "consent_required") ? "ready" : "error";
      c.detail = msg; J.emit("connections");
      const err = new Error(c.name + ": " + msg); err.code = e && e.code; err.retryable = !!(e && e.retryable); throw err;
    }
  }
  const strip = s => String(s || "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[͏‌​\s]+/g, " ").trim();

  J.gmail = {
    async search(query, n = 10) {
      const p = await call("gmail", "search_threads", { query, pageSize: n, view: "THREAD_VIEW_SUMMARY" });
      return ((p && p.threads) || []).map(t => { const m = (t.messages || [])[0] || {};
        const who = (m.addressDisplayNames || []).find(a => a.emailAddress === m.sender);
        return { id: t.id, subject: strip(m.subject) || "(no subject)", from: (who && who.displayName) || m.sender || "", fromEmail: m.sender || "",
                 date: m.date, snippet: strip(m.snippet).slice(0, 220), unread: (m.labelIds || []).includes("UNREAD"),
                 important: (m.labelIds || []).includes("IMPORTANT"), url: t.viewUrl || m.viewUrl, messageId: m.id, count: t.messageCount }; });
    },
    async thread(id) {
      const p = await call("gmail", "get_thread", { threadId: String(id), messageFormat: "PLAIN_TEXT" });
      return ((p && p.messages) || []).map(m => ({ id: m.id, from: m.sender, date: m.date, subject: strip(m.subject), body: String(m.plaintextBody || m.snippet || "").slice(0, 6000) }));
    },
    async draft({ to, subject, body, replyToMessageId }) {
      const input = { subject: subject || "", body: body || "" };
      if (to && to.length) input.to = [].concat(to);
      if (replyToMessageId) input.replyToMessageId = replyToMessageId;
      return call("gmail", "create_draft", input);
    },
  };
  J.calendar = {
    async list(start, end, n = 25) {
      const input = { orderBy: "startTime", pageSize: n };
      if (start) input.startTime = start; if (end) input.endTime = end;
      const p = await call("calendar", "list_events", input);
      return ((p && p.events) || []).filter(e => e.status !== "cancelled").map(e => ({ id: e.id, title: e.summary || "(no title)",
        start: (e.start && (e.start.dateTime || e.start.date)) || "", end: (e.end && (e.end.dateTime || e.end.date)) || "",
        allDay: !!(e.start && e.start.date && !e.start.dateTime), url: e.htmlLink, location: e.location || "" }));
    },
    async create({ title, start, end, description, location }) {
      return call("calendar", "create_event", { summary: title, startTime: start, endTime: end, description: description || "", location: location || "" });
    },
  };
  J.drive = {
    async search(text, n = 10) {
      const safe = String(text || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const query = safe ? `fullText contains '${safe}' or title contains '${safe}'` : "owner = 'me'";
      const p = await call("drive", "search_files", { query, pageSize: n, excludeContentSnippets: true, orderBy: safe ? "" : "modifiedTime desc" });
      return ((p && p.files) || []).map(f => ({ id: f.id, title: f.title, type: kind(f.mimeType), modified: f.modifiedTime, url: f.viewUrl }));
    },
  };
  function kind(m = "") { return /document/.test(m) ? "Doc" : /spreadsheet/.test(m) ? "Sheet" : /presentation/.test(m) ? "Slides" : /pdf/.test(m) ? "PDF"
    : /folder/.test(m) ? "Folder" : /image/.test(m) ? "Image" : /video/.test(m) ? "Video" : "File"; }

  // ---- platforms: what each one can honestly do from here today
  J.PLATFORMS = [
    { key: "gmail", name: "Gmail", url: "https://mail.google.com", conn: "gmail", can: "Read, summarise and search mail; create drafts after your approval. Jarvis never sends mail.", group: "Google" },
    { key: "calendar", name: "Google Calendar", url: "https://calendar.google.com", conn: "calendar", can: "Read your schedule; add events after your approval.", group: "Google" },
    { key: "drive", name: "Google Drive", url: "https://drive.google.com", conn: "drive", can: "Search your files and open them.", group: "Google" },
    { key: "instagram", name: "Instagram", url: "https://www.instagram.com", needs: "Meta developer app, Instagram Business or Creator account linked to a Facebook Page, Meta app review for publishing and insights, and a server to hold the login token.", can: "Open it; write captions, reel ideas, hashtags and a content calendar in Content Studio.", group: "Social" },
    { key: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com", needs: "WhatsApp Business Platform (Cloud API) through Meta: a verified business, a dedicated phone number, approved message templates and a server for webhooks. Per-conversation charges apply.", can: "Open WhatsApp Web; draft messages and customer reply templates to copy.", group: "Social" },
    { key: "youtube", name: "YouTube", url: "https://www.youtube.com", needs: "Google Cloud project with the YouTube Data API, OAuth consent screen verification for upload scopes, and a server for tokens and uploads.", can: "Open and search it; write scripts, titles, descriptions and tags in Content Studio.", group: "Social", search: q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) },
    { key: "studio", name: "YouTube Studio", url: "https://studio.youtube.com", group: "Social", can: "Open your channel dashboard." },
    { key: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com", needs: "LinkedIn developer app; posting as a company page needs the Community Management API, which LinkedIn must approve.", can: "Open it; write posts, connection messages and company updates in Content Studio.", group: "Social" },
    { key: "facebook", name: "Facebook", url: "https://www.facebook.com", needs: "Meta developer app with Pages permissions (app review) and a server to hold the page token.", can: "Open it; write page posts in Content Studio.", group: "Social" },
    { key: "telegram", name: "Telegram", url: "https://web.telegram.org", needs: "A bot from @BotFather and a small server to hold the bot token and receive updates.", can: "Open Telegram Web; draft announcements.", group: "Social" },
    { key: "x", name: "X (Twitter)", url: "https://x.com", group: "Social", can: "Open it." },
    { key: "google", name: "Google", url: "https://www.google.com", group: "Web", search: q => "https://www.google.com/search?q=" + encodeURIComponent(q) },
    { key: "maps", name: "Google Maps", url: "https://maps.google.com", group: "Web", search: q => "https://www.google.com/maps/search/" + encodeURIComponent(q) },
    { key: "news", name: "Google News", url: "https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN:en", group: "Web",
      search: q => "https://news.google.com/search?q=" + encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en" },
    { key: "docs", name: "Google Docs", url: "https://docs.google.com/document/u/0/", group: "Google" },
    { key: "sheets", name: "Google Sheets", url: "https://docs.google.com/spreadsheets/u/0/", group: "Google" },
    { key: "meet", name: "Google Meet", url: "https://meet.google.com", group: "Google" },
    { key: "claude", name: "Claude", url: "https://claude.ai", group: "Web" },
    { key: "zerodha", name: "Zerodha Kite", url: "https://kite.zerodha.com", group: "Investing" },
    { key: "groww", name: "Groww", url: "https://groww.in", group: "Investing" },
    { key: "moneycontrol", name: "Moneycontrol", url: "https://www.moneycontrol.com", group: "Investing" },
    { key: "screener", name: "Screener", url: "https://www.screener.in", group: "Investing" },
    { key: "tradingview", name: "TradingView", url: "https://www.tradingview.com", group: "Investing" },
    { key: "nse", name: "NSE India", url: "https://www.nseindia.com", group: "Investing" },
    { key: "amazon", name: "Amazon", url: "https://www.amazon.in", group: "Web" },
    { key: "github", name: "GitHub", url: "https://github.com", group: "Web" },
  ];
  const ALIAS = { mail: "gmail", "g mail": "gmail", email: "gmail", inbox: "gmail", "whats app": "whatsapp", "whatsapp web": "whatsapp", insta: "instagram", ig: "instagram",
    yt: "youtube", "youtube studio": "studio", "linked in": "linkedin", fb: "facebook", twitter: "x", "google drive": "drive", "my drive": "drive",
    "google calendar": "calendar", "my calendar": "calendar", "google maps": "maps", map: "maps", kite: "zerodha", "trading view": "tradingview", "money control": "moneycontrol",
    "google docs": "docs", "google sheets": "sheets", "google meet": "meet", browser: "google", "my browser": "google", "web browser": "google", telegram: "telegram" };

  J.allApps = () => J.PLATFORMS.concat((J.data.settings.shortcuts || []).map(s => ({ key: "c:" + s.id, name: s.name, url: s.url, group: "My shortcuts", custom: true, id: s.id })));
  J.findApp = name => {
    let n = String(name || "").toLowerCase().replace(/^(the|my)\s+/, "").replace(/\s+(app|website|site|web|page|account)$/, "").trim();
    n = ALIAS[n] || n;
    const apps = J.allApps();
    return apps.find(a => a.key === n || a.name.toLowerCase() === n) || apps.find(a => a.custom && a.name.toLowerCase().includes(n))
      || apps.find(a => a.name.toLowerCase().startsWith(n) && n.length > 2) || null;
  };
  // Browsers only let a page open a tab from your own click, so Jarvis shows a launch button; it never claims an app opened.
  J.launchCard = app => { J.noteRecent(app.key); return { label: "Open " + app.name, href: app.url }; };
  J.noteRecent = key => { const r = J.data.settings.recent = (J.data.settings.recent || []).filter(k => k !== key); r.unshift(key); r.length = Math.min(r.length, 8); J.save("settings"); };
})(window.J);
