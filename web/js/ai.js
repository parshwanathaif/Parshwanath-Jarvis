/* Jarvis web — AI command engine (Claude with tools), research, content generation. */
"use strict";
(function (J) {
  let sample = null;
  J.ai = { available: false, history: [], session: [] };
  J.initAI = async () => { sample = window.claude && window.claude.use ? await window.claude.use("sample") : null; J.ai.available = !!sample; J.emit("ai"); };
  const AIERR = { not_granted: "The AI brain isn't allowed for this page. Allow “Ask Claude” in the page's Permissions menu.",
    rate_limited: "The AI brain is busy right now. Try again in a minute.", cancelled: "Stopped." };
  const aiError = e => AIERR[e && e.code] || "I couldn't get an answer from the AI brain just now.";

  function persona() { return J.data.settings.persona === "friday" ? "Friday" : "Jarvis"; }
  function context() {
    const s = J.data.settings, mem = J.data.memory.enabled ? J.data.memory.items.map(m => "- " + m.text).join("\n") : "";
    const tasks = J.sortedTasks().slice(0, 15).map((t, i) => `${i + 1}. ${t.title}${t.due ? " (due " + t.due + ")" : ""} [${t.priority}]`).join("\n") || "none";
    return `You are ${persona()}, a voice-first personal and business assistant for ${s.name || "the user"}, who runs Parshwanath Life Science (pharma / chemicals trading and export, India) and also invests.
Now: ${new Date().toString()}. Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.
Replies are read aloud: plain spoken sentences, no markdown, lists, tables or symbols; usually 1 to 4 sentences; lead with the result. Reply in the language the user used (English, Hindi or Hinglish).
Act through the tools instead of describing what you would do. Use the tools' results; never invent emails, events, files or numbers.
Anything that changes an outside account (calendar events, email drafts) must go through the propose_ tools: they wait for the user's approval, so say it is waiting for approval, never that it is done.
You cannot send email, post to social media, send WhatsApp messages or open desktop programs. Say so plainly and offer what you can do: draft the text, or show a button to open the app.
If a request is ambiguous, ask one short clarifying question.
Open tasks:\n${tasks}
${mem ? "Things the user asked you to remember:\n" + mem : ""}${J.ai.session.length ? "\nRemembered this session:\n" + J.ai.session.map(x => "- " + x).join("\n") : ""}`;
  }

  // ---- tools the AI may call. Reads run at once; writes become approval cards.
  function tools(out) {
    const t = (name, description, props, required, execute) => ({ name, description, inputSchema: { type: "object", properties: props || {}, required: required || [] }, execute });
    const str = d => ({ type: "string", description: d });
    return [
      t("create_task", "Add a task to the user's task list. Returns the saved task.", { title: str("Short imperative title"), due: str("ISO date YYYY-MM-DD or local datetime YYYY-MM-DDTHH:MM:00, optional"),
        priority: { type: "string", enum: ["high", "medium", "low"] }, remind: { type: "boolean", description: "Alert the user at the due time" } }, ["title"],
        i => { const x = J.addTask({ title: String(i.title), due: i.due ? String(i.due) : "", priority: i.priority, remind: !!i.remind }); out.view = out.view || "tasks"; return x; }),
      t("list_tasks", "List the user's open tasks, sorted by due date and priority.", { scope: { type: "string", enum: ["today", "overdue", "all"] } }, [],
        i => J.tasksDue(i.scope || "all").map(x => ({ title: x.title, due: x.due, priority: x.priority, project: x.project }))),
      t("complete_task", "Mark an open task done, found by its number in the list or words from its title.", { query: str("Task number or words") }, ["query"],
        i => { const x = J.findTask(String(i.query)); if (!x) throw new Error("No open task matches."); J.completeTask(x); return "Done: " + x.title; }),
      t("get_calendar", "Read the user's Google Calendar events between two local datetimes (YYYY-MM-DDTHH:MM:00).", { start: str("Start"), end: str("End") }, ["start", "end"],
        async i => { const ev = await J.calendar.list(String(i.start), String(i.end), 30); out.events = ev; return ev; }),
      t("propose_calendar_event", "Prepare a Google Calendar event. It is created only after the user approves it on screen.", { title: str("Title"), start: str("Local datetime YYYY-MM-DDTHH:MM:00"),
        end: str("Local datetime"), description: str("Optional notes"), location: str("Optional") }, ["title", "start", "end"], i => {
        const ev = { title: String(i.title), start: String(i.start), end: String(i.end), description: i.description ? String(i.description) : "", location: i.location ? String(i.location) : "" };
        J.requestApproval({ title: `Add “${ev.title}” to Google Calendar, ${J.niceDate(ev.start)}`, detail: ev.description, run: async () => { await J.calendar.create(ev); return `Added ${ev.title} to your calendar.`; } });
        return "Waiting for the user's approval on screen."; }),
      t("search_email", "Search the user's Gmail with Gmail query syntax (e.g. 'is:unread in:inbox newer_than:2d', 'from:anupam'). Returns subject, sender, date, snippet and thread id. Previews only: call read_email for full text.",
        { query: str("Gmail query"), max: { type: "number" } }, ["query"], async i => { const r = await J.gmail.search(String(i.query), Math.min(20, Number(i.max) || 10)); out.mail = r; return r.map(({ url, ...x }) => x); }),
      t("read_email", "Read a full Gmail thread by its thread id.", { id: str("Thread id") }, ["id"], async i => J.gmail.thread(String(i.id))),
      t("propose_email_draft", "Prepare a Gmail DRAFT (never sent). Created in the user's Drafts folder only after they approve it on screen.",
        { to: { type: "array", items: { type: "string" }, description: "Email addresses" }, subject: str("Subject"), body: str("Plain-text body"), replyToMessageId: str("Optional message id when replying") },
        ["subject", "body"], i => {
        const d = { to: (i.to || []).map(String).filter(x => /@/.test(x)), subject: String(i.subject), body: String(i.body), replyToMessageId: i.replyToMessageId ? String(i.replyToMessageId) : "" };
        J.requestApproval({ title: `Save email draft “${d.subject}”${d.to.length ? " to " + d.to.join(", ") : ""}`, detail: d.body,
          run: async () => { const r = await J.gmail.draft(d); return "Draft saved in Gmail" + (r && r.viewUrl ? "." : ". Open Gmail Drafts to review and send it."); } });
        return "Draft is waiting for the user's approval on screen. It will not be sent."; }),
      t("search_drive", "Search the user's Google Drive by words in the title or content. Empty text lists recent files.", { text: str("Words") }, [],
        async i => { const r = await J.drive.search(String(i.text || ""), 10); out.files = r; return r.map(({ url, ...x }) => x); }),
      t("show_app", "Show the user a button to open a website or app (Gmail, WhatsApp, Instagram, YouTube, LinkedIn, Facebook, Telegram, Drive, Calendar, Zerodha …), optionally with a search.",
        { app: str("App name"), search: str("Optional search words") }, ["app"], i => {
        const app = J.findApp(String(i.app)); if (!app) throw new Error("Unknown app. Known: " + J.allApps().map(a => a.name).join(", "));
        out.links.push(i.search && app.search ? { label: `${app.name}: ${i.search}`, href: app.search(String(i.search)) } : J.launchCard(app)); J.ctx.lastApp = app.key; return "Button shown."; }),
      t("save_content", "Save a piece of content (post, caption, script, email, message template) to the Content Studio library as a draft for the user to review.",
        { platform: str("instagram, youtube, linkedin, facebook, whatsapp, telegram, email, blog or general"), type: str("e.g. caption, reel idea, script, title, post"), title: str("Short title"), body: str("Full text"), date: str("Optional planned date YYYY-MM-DD") },
        ["platform", "title", "body"], i => { const c = J.saveContent({ platform: String(i.platform), type: String(i.type || "post"), title: String(i.title), body: String(i.body), date: i.date ? String(i.date) : "" }); out.view = "content"; return "Saved as draft " + c.id; }),
      t("remember", "Save a fact the user explicitly asked you to remember.", { fact: str("The fact") }, ["fact"], i => {
        if (!J.data.memory.enabled) { J.ai.session.push(String(i.fact)); return "Saved for this session only (long-term memory is off in Settings)."; }
        J.data.memory.items.push({ id: J.uid(), text: String(i.fact), t: Date.now() }); J.save("memory"); J.log("Memory saved", i.fact); return "Saved."; }),
      t("get_portfolio", "The user's stock holdings with average cost and the last price they entered (not live).", {}, [], () => J.snapshot().rows.map(r => ({ stock: r.s, qty: r.qty, avg: r.avg, last: r.ltp, priceDate: r.at }))),
      t("run_mode", "Start one of the user's workflows or modes: business, focus, content, research, or a custom workflow name.", { name: str("Mode or workflow name") }, ["name"],
        i => { const f = J.findFlow(String(i.name)); if (!f) throw new Error("No workflow called " + i.name); out.after = () => J.runFlow(f.id); return "Starting " + f.name; }),
    ];
  }

  J.agent = async (q, { onText } = {}) => {
    if (!sample) return { speech: "I don't have a built-in command for that, and the AI brain isn't available in this view. Say help to see my commands." };
    const out = { links: [], view: null };
    const msgs = [{ role: "user", content: context() }, { role: "assistant", content: "Understood." }];
    for (const [u, a] of J.ai.history.slice(-8)) msgs.push({ role: "user", content: u }, { role: "assistant", content: a });
    msgs.push({ role: "user", content: q });
    const log = J.log("AI command", q, "running");
    try {
      const res = await sample(msgs, { cache: false, tools: tools(out), onText: ({ text }) => onText && onText(text) });
      const text = (res.text || "").split(/\n\s*\n/).pop().trim() || res.text;     // with tools, the last round is the answer
      J.ai.history.push([q, text]); if (J.ai.history.length > 20) J.ai.history.shift();
      J.setStatus(log, "done", q);
      if (out.after) setTimeout(out.after, 300);
      return Object.assign({ speech: text + (res.truncated ? " (cut short)" : "") }, out);
    } catch (e) { J.setStatus(log, "failed", q + " — " + (e.code || e.message)); return { speech: aiError(e), links: out.links }; }
  };

  // ---- research: an organised report from Claude's knowledge (it cannot browse the live web from here)
  J.research = async (topic, { onText } = {}) => {
    if (!sample) throw new Error("The AI brain isn't available in this view.");
    const prompt = `Prepare a concise business research brief on: ${topic}
For: the owner of Parshwanath Life Science, an Indian pharma / chemicals trading and export business.
Use exactly these plain-text sections, each a heading line followed by short paragraphs or "- " bullet lines:
SUMMARY
KEY FINDINGS
OPPORTUNITIES
RISKS
NEXT STEPS (3 to 5 concrete actions)
SOURCES TO CHECK (named organisations, databases or publications to verify current figures)
You cannot browse the web: say where figures may be out of date, give no invented statistics, and mark estimates as estimates. No markdown symbols other than "- ".`;
    const log = J.log("Research", topic, "running");
    try { const r = await sample(prompt, { cache: false, modelTier: "complex", onText: ({ text }) => onText && onText(text) });
      J.setStatus(log, "done", topic); return r.text; }
    catch (e) { J.setStatus(log, "failed", topic + " — " + (e.code || e.message)); throw new Error(aiError(e)); }
  };
  J.researchReply = async q => {
    J.$("rtopic").value = q; J.runResearch();          // runs in the background; the brief lands in Business intelligence
    return { speech: `Researching ${q}. I'll tell you when the brief is ready.`, view: "research" };
  };

  // ---- content studio generation
  J.CONTENT_TYPES = {
    "ig-caption": { label: "Instagram captions", platform: "instagram", ask: "Instagram post captions with a hook first line, short body, call to action and 8-15 relevant hashtags" },
    "ig-reel": { label: "Instagram reel ideas", platform: "instagram", ask: "Instagram reel ideas, each with hook, shot-by-shot outline (5-7 shots), on-screen text, caption and hashtags" },
    "yt-script": { label: "YouTube video script", platform: "youtube", ask: "a complete YouTube video script with hook (first 15 seconds), intro, 4-6 sections with talking points, and a call to action; include suggested B-roll in [brackets]", one: true },
    "yt-package": { label: "YouTube title, description & tags", platform: "youtube", ask: "YouTube publishing packages: a click-worthy but honest title (under 70 characters), an SEO description (150-250 words with timestamps placeholder lines), 15 tags, 5 hashtags, and a thumbnail concept" },
    "yt-ideas": { label: "YouTube video ideas", platform: "youtube", ask: "YouTube video ideas with working title, angle, target viewer and why it can perform" },
    "li-post": { label: "LinkedIn posts", platform: "linkedin", ask: "LinkedIn posts in a professional, first-person voice: a strong opening line, 120-220 words, short paragraphs, a question to drive comments, 3-5 hashtags" },
    "li-message": { label: "LinkedIn connection messages", platform: "linkedin", ask: "short LinkedIn connection or follow-up messages (under 300 characters each), personal and specific" },
    "fb-post": { label: "Facebook page posts", platform: "facebook", ask: "Facebook page posts with an engaging opener, 60-150 words, and a call to action" },
    "wa-template": { label: "WhatsApp replies & templates", platform: "whatsapp", ask: "WhatsApp Business message templates for customers: polite, clear, under 600 characters, with {{1}}-style placeholders for names and details" },
    "tg-announce": { label: "Telegram announcements", platform: "telegram", ask: "Telegram channel announcements, scannable, with a clear headline line" },
    "email": { label: "Business emails", platform: "email", ask: "professional business emails with a subject line and a plain-text body" },
    "ad-copy": { label: "Ad copy", platform: "general", ask: "advertisement copy variants: headline (under 40 characters), primary text (under 125 characters) and call-to-action button text" },
    "proposal": { label: "Business proposal", platform: "general", ask: "a business proposal with sections: Overview, Understanding of needs, Proposed solution, Deliverables, Timeline, Commercials (placeholders), Why us, Next steps", one: true },
    "repurpose": { label: "Repurpose content across platforms", platform: "general", ask: "versions of the given content adapted for Instagram, LinkedIn, Facebook and YouTube (community post), one item per platform, each in that platform's native style" },
  };
  J.generateContent = async ({ type, topic, n = 5, tone = "" }) => {
    if (!sample) throw new Error("The AI brain isn't available in this view.");
    const ct = J.CONTENT_TYPES[type]; const count = ct.one ? 1 : Math.max(1, Math.min(10, n));
    const prompt = `Write ${count} ${ct.ask}.
Topic or source material: ${topic}
Business: ${J.data.settings.business || "Parshwanath Life Science — pharma / chemicals trading and export, India"}.${tone ? " Tone: " + tone + "." : ""}
Each item must be distinct. Reply with only a JSON array of ${count} objects: [{"title": "short label", "body": "the full text, with line breaks as \\n"}]`;
    const log = J.log("Content generated", `${ct.label}: ${topic}`, "running");
    try {
      const v = await sample.json(prompt, { cache: false });
      const items = (Array.isArray(v) ? v : [v]).filter(x => x && x.body).map(x => ({ title: String(x.title || ct.label).slice(0, 120), body: String(x.body) }));
      if (!items.length) throw new Error("The answer was empty.");
      J.setStatus(log, "done", `${ct.label}: ${topic} (${items.length})`); return items;
    } catch (e) { J.setStatus(log, "failed", `${ct.label}: ${topic} — ${e.code || e.message}`); throw new Error(e.code === "invalid_json" ? "The answer came back in the wrong format. Try again." : aiError(e)); }
  };
  J.saveContent = ({ platform, type, title, body, date }) => {
    const c = { id: J.uid(), platform: platform || "general", type: type || "post", title, body, date: date || "", status: "draft", created: Date.now() };
    J.data.content.items.unshift(c); J.save("content"); J.emit("content"); J.log("Content saved", `${c.platform}: ${c.title}`); return c;
  };

  J.calendarForTask = async t => {
    const end = new Date(new Date(t.due).getTime() + 30 * 60000);
    J.requestApproval({ title: `Add “${t.title}” to Google Calendar, ${J.niceDate(t.due)}`, detail: "30 minutes, with your calendar's default reminder",
      run: async () => { await J.calendar.create({ title: t.title, start: t.due, end: J.localIso(end), description: "Added by Jarvis" }); return "Added to your Google Calendar."; } });
    return { speech: "Approve the calendar entry on screen and I'll add it." };
  };
})(window.J);
