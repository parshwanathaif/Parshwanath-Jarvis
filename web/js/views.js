/* Jarvis web — the screens. Each render reads J.data and the live connector state. */
"use strict";
(function (J) {
  const { el, $ } = J;
  const btn = (label, onclick, cls = "btn", attrs) => { const b = el("button", label, cls, Object.assign({ type: "button" }, attrs || {})); b.onclick = onclick; return b; };
  const empty = text => el("p", text, "empty");
  const section = (title, sub) => { const s = el("section", null, "card"); const h = el("h2", title); if (sub) h.append(el("small", sub)); s.append(h); return s; };
  const pill = (text, kind) => el("span", text, "pill " + (kind || ""));

  // ======================= HOME (assistant)
  J.renderHome = () => {
    const box = $("homeExtra"); box.replaceChildren();
    const tasks = J.tasksDue("today");
    const t = section("Today", new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }));
    const row = el("div", null, "stats");
    const stat = (n, label, view) => { const b = btn("", () => J.go(view), "stat"); b.append(el("b", String(n)), el("span", label)); return b; };
    row.append(stat(tasks.length, "tasks today", "tasks"), stat(J.tasksDue("overdue").length, "overdue", "tasks"),
      stat(J.approvals.filter(a => a.status === "pending").length, "waiting approval", "activity"), stat(J.data.content.items.filter(c => c.status === "draft").length, "content drafts", "content"));
    t.append(row);
    if (tasks.length) { const ul = el("ul", null, "list"); tasks.slice(0, 5).forEach(x => ul.append(taskRow(x))); t.append(ul); }
    t.append(el("div", null, "row"), btn("Daily briefing", () => J.send("daily briefing")), btn("Business mode", () => J.send("activate business mode")));
    box.append(t);
    const fav = section("Quick launch");
    const grid = el("div", null, "launch");
    (J.data.settings.favorites || []).map(k => J.allApps().find(a => a.key === k)).filter(Boolean).forEach(a => grid.append(J.linkBtn(a.name, a.url)));
    fav.append(grid); box.append(fav);
    const pend = J.approvals.filter(a => a.status === "pending");
    if (pend.length) { const ap = section("Waiting for your approval"); pend.forEach(a => ap.append(approvalCard(a))); box.prepend(ap); }
  };
  J.showFlowOutput = x => {
    const box = $("flowout"); if (!box) return;
    if (x.briefing) { const b = x.briefing; box.replaceChildren(); const s = section("Daily briefing", new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
      s.append(el("p", b.speech));
      if (b.events && b.events.length) s.append(J.table({ title: "", columns: ["Time", "Event"], rows: b.events.map(e => [e.allDay ? "All day" : new Date(e.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), { text: e.title, href: e.url }]) }));
      if (b.mail && b.mail.length) s.append(mailTable(b.mail));
      b.errors.forEach(e => s.append(el("p", e, "err")));
      box.append(s); }
    if (x.events) { const s = section("Calendar today"); s.append(x.events.length ? J.table({ title: "", columns: ["Time", "Event"], rows: x.events.map(e => [e.allDay ? "All day" : new Date(e.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), { text: e.title, href: e.url }]) }) : empty("Nothing else today.")); box.append(s); }
    if (x.mail) { const s = section("Unread email"); s.append(x.mail.length ? mailTable(x.mail) : empty("No unread email.")); box.append(s); }
    if (x.links && x.links.length) { const s = section("Your apps"); const g = el("div", null, "launch"); x.links.forEach(l => g.append(J.linkBtn(l.label, l.href))); s.append(g); box.append(s); }
    if (x.reply) { const s = section("Jarvis"); s.append(el("p", x.reply.speech)); box.append(s); }
  };
  const mailTable = mail => J.table({ title: "", columns: ["From", "Subject", "When"], rows: mail.map(m => [m.from, { text: m.subject, href: m.url }, J.niceDate(m.date ? J.localIso(new Date(m.date)) : "")]) });

  // ======================= approvals (conversation + home + activity)
  function approvalCard(a) {
    const c = el("div", null, "approval " + a.status);
    c.append(el("b", a.title)); if (a.detail) c.append(el("pre", a.detail));
    const r = el("div", null, "row");
    if (a.status === "pending") r.append(btn("Approve", () => J.decide(a, true), "btn primary"), btn("Cancel", () => J.decide(a, false)));
    else r.append(pill({ running: "Working…", done: "Done", failed: "Failed", cancelled: "Cancelled" }[a.status] || a.status, a.status), el("span", a.result || "", "muted"));
    c.append(r); return c;
  }
  J.approvalCard = approvalCard;

  // ======================= TASKS & CALENDAR
  function taskRow(t) {
    const li = el("li", null, "task " + t.priority + (t.done ? " done" : ""));
    const cb = el("input", null, "", { type: "checkbox", "aria-label": "Done: " + t.title }); cb.checked = t.done;
    cb.onchange = () => { if (cb.checked) J.completeTask(t); else { t.done = false; J.save("tasks"); J.emit("tasks"); } };
    const body = el("div", null, "grow"); body.append(el("span", t.title, "ttl"));
    const meta = el("span", null, "meta");
    if (t.due) meta.append(pill(J.niceDate(t.due), t.due.slice(0, 10) < J.today() && !t.done ? "bad" : ""));
    if (t.priority === "high") meta.append(pill("High", "warn")); if (t.remindAt) meta.append(pill(t.reminded ? "Reminded" : "Reminder set"));
    if (t.project) meta.append(pill(t.project));
    body.append(meta);
    const acts = el("div", null, "acts");
    if (t.due && t.due.length > 10 && !t.done) acts.append(btn("Add to Calendar", () => J.calendarForTask(t), "mini"));
    acts.append(btn("Delete", () => J.deleteTask(t), "mini danger"));
    li.append(cb, body, acts); return li;
  }
  J.renderTasks = () => {
    const box = $("tasksBody"); box.replaceChildren();
    const add = section("Add a task", "type naturally: “Call Anupam Rasayan tomorrow at 11 am, high priority”");
    const f = el("form", null, "row"); const i = el("input", null, "", { type: "text", id: "newtask", placeholder: "New task", "aria-label": "New task" });
    const rem = el("label", null, "chk"); const rc = el("input", null, "", { type: "checkbox", id: "newtaskrem" }); rem.append(rc, document.createTextNode(" Remind me"));
    f.append(i, rem, el("button", "Add", "btn primary", { type: "submit" }));
    f.onsubmit = e => { e.preventDefault(); if (!i.value.trim()) return; try { J.taskFromSpeech(i.value, { remind: rc.checked }); i.value = ""; } catch (x) { J.toast(x.message, "bad"); } };
    add.append(f); box.append(add);
    const groups = [["Overdue", J.tasksDue("overdue")], ["Today & high priority", J.tasksDue("today").filter(t => !(t.due && t.due.slice(0, 10) < J.today()))],
      ["Upcoming", J.sortedTasks(J.data.tasks.items.filter(t => !t.done && t.due && t.due.slice(0, 10) > J.today()))],
      ["No date", J.sortedTasks(J.data.tasks.items.filter(t => !t.done && !t.due && t.priority !== "high"))],
      ["Completed", J.data.tasks.items.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 10)]];
    for (const [name, items] of groups) { if (!items.length && name !== "Today & high priority") continue;
      const s = section(name, items.length + ""); const ul = el("ul", null, "list");
      items.forEach(t => ul.append(taskRow(t))); s.append(items.length ? ul : empty("Nothing due today.")); box.append(s); }
    const cal = section("Google Calendar", "next 7 days"); const cb = el("div", null, "calbox"); cb.append(empty("Loading your calendar…")); cal.append(cb); box.append(cal);
    const now = new Date(), end = new Date(Date.now() + 7 * 864e5);
    J.calendar.list(J.localIso(now), J.localIso(end), 40).then(ev => { cb.replaceChildren(ev.length ? J.table({ title: "", columns: ["When", "Event", "Where"],
      rows: ev.map(e => [e.allDay ? J.niceDate(e.start.slice(0, 10)) : J.niceDate(J.localIso(new Date(e.start))), { text: e.title, href: e.url }, e.location || ""]) }) : empty("No events in the next 7 days.")); })
      .catch(e => { cb.replaceChildren(el("p", e.message, "err"), btn("Try again", J.renderTasks)); });
  };

  // ======================= CONTENT STUDIO
  let lastGenerated = [];
  J.renderContent = () => {
    const box = $("contentBody"); box.replaceChildren();
    const gen = section("Create", "AI drafts you can edit, approve and save");
    const f = el("form", null, "grid2");
    const sel = el("select", null, "", { id: "ctype", "aria-label": "Format" });
    for (const k in J.CONTENT_TYPES) sel.append(el("option", J.CONTENT_TYPES[k].label, "", { value: k }));
    const topic = el("textarea", null, "", { id: "ctopic", rows: "3", placeholder: "Topic, product, offer or text to repurpose. Example: our new API export range for Gulf buyers", "aria-label": "Topic" });
    const n = el("input", null, "", { type: "number", id: "ccount", min: "1", max: "10", value: "5", "aria-label": "How many" });
    const tone = el("input", null, "", { type: "text", id: "ctone", placeholder: "Tone (optional): confident, friendly, technical…", "aria-label": "Tone" });
    const go = el("button", "Generate", "btn primary", { type: "submit", id: "cgo" });
    const lab = (t, c) => { const l = el("label", null, "field"); l.append(el("span", t), c); return l; };
    f.append(lab("Format", sel), lab("How many", n), lab("Topic", topic), lab("Tone", tone), go);
    const out = el("div", null, "gen", { id: "cout" });
    f.onsubmit = async e => { e.preventDefault(); if (!topic.value.trim()) { topic.focus(); return; }
      go.disabled = true; go.textContent = "Writing…"; out.replaceChildren(empty("Writing drafts…"));
      try { lastGenerated = (await J.generateContent({ type: sel.value, topic: topic.value, n: +n.value, tone: tone.value })).map(x => Object.assign(x, { type: sel.value })); renderGenerated(out); }
      catch (x) { out.replaceChildren(el("p", x.message, "err")); }
      go.disabled = false; go.textContent = "Generate"; };
    gen.append(f, out); box.append(gen);
    if (lastGenerated.length) renderGenerated(out);
    // library & calendar
    const lib = section("Library & content calendar", J.data.content.items.length + " items");
    const filt = el("div", null, "row");
    const fsel = el("select", null, "", { "aria-label": "Filter by platform", id: "cfilter" }); ["all", "instagram", "youtube", "linkedin", "facebook", "whatsapp", "telegram", "email", "general"].forEach(p => fsel.append(el("option", p === "all" ? "All platforms" : p[0].toUpperCase() + p.slice(1), "", { value: p })));
    fsel.value = J.contentFilter || "all"; fsel.onchange = () => { J.contentFilter = fsel.value; J.renderContent(); };
    filt.append(fsel); lib.append(filt);
    const items = J.data.content.items.filter(c => (J.contentFilter || "all") === "all" || c.platform === J.contentFilter)
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || b.created - a.created);
    if (!items.length) lib.append(empty("Nothing saved yet. Generate drafts above, or ask: “Jarvis, create five Instagram post ideas for my business.”"));
    items.forEach(c => lib.append(contentCard(c)));
    box.append(lib);
  };
  function renderGenerated(out) {
    out.replaceChildren();
    lastGenerated.forEach((g, idx) => { const card = el("div", null, "draft");
      const ta = el("textarea", null, "", { rows: "6", "aria-label": "Draft " + (idx + 1), id: "gen" + idx }); ta.value = g.body;
      card.append(el("b", g.title), ta);
      const r = el("div", null, "row");
      r.append(btn("Save to library", () => { J.saveContent({ platform: J.CONTENT_TYPES[g.type].platform, type: J.CONTENT_TYPES[g.type].label, title: g.title, body: ta.value });
        lastGenerated.splice(idx, 1); J.renderContent(); }, "btn primary"), btn("Copy", e => J.copy(ta.value, e.target)));
      card.append(r); out.append(card); });
  }
  function contentCard(c) {
    const d = el("details", null, "content st-" + c.status);
    const s = el("summary"); s.append(pill(c.platform), el("span", c.title, "ttl"), pill(c.status === "approved" ? "Approved" : c.status === "posted" ? "Posted" : "Draft", c.status === "approved" ? "ok" : c.status === "posted" ? "" : "warn"));
    if (c.date) s.append(pill(J.niceDate(c.date)));
    const ta = el("textarea", null, "", { rows: "8", "aria-label": "Edit " + c.title }); ta.value = c.body;
    ta.onchange = () => { c.body = ta.value; J.save("content"); };
    const date = el("input", null, "", { type: "date", "aria-label": "Planned date" }); date.value = c.date || ""; date.onchange = () => { c.date = date.value; J.save("content"); J.renderContent(); };
    const app = J.findApp(c.platform === "email" ? "gmail" : c.platform);
    const r = el("div", null, "row");
    const lab = el("label", null, "field inline"); lab.append(el("span", "Planned"), date);
    r.append(lab, btn("Copy", e => J.copy(ta.value, e.target)));
    if (c.status === "draft") r.append(btn("Approve", () => { c.status = "approved"; J.save("content"); J.log("Content approved", c.title); J.renderContent(); }, "btn primary"));
    if (c.status === "approved") r.append(btn("Mark as posted", () => { c.status = "posted"; J.save("content"); J.log("Content marked posted", c.title); J.renderContent(); }));
    if (app) r.append(J.linkBtn("Open " + app.name, app.url));
    if (c.platform === "email") r.append(btn("Save as Gmail draft…", () => { J.requestApproval({ title: `Save “${c.title}” as a Gmail draft`, detail: ta.value,
      run: async () => { await J.gmail.draft({ subject: c.title, body: ta.value }); return "Draft saved in Gmail. It has not been sent."; } }); J.go("activity"); }));
    r.append(btn("Delete", () => { J.data.content.items = J.data.content.items.filter(x => x !== c); J.save("content"); J.log("Content deleted", c.title); J.renderContent(); }, "btn danger"));
    d.append(s, ta, r); return d;
  }

  // ======================= RESEARCH (business intelligence)
  J.runResearch = async () => {
    const topic = $("rtopic").value.trim(); if (!topic) return;
    const out = $("rout"), go = $("rgo"); go.disabled = true; go.textContent = "Researching…";
    out.replaceChildren(empty("Working on the brief. This can take a minute."));
    const pre = el("div", null, "report");
    try { const text = await J.research(topic, { onText: t => { if (!pre.isConnected) out.replaceChildren(pre); pre.textContent = t; } });
      out.replaceChildren(reportView(topic, text));
      J.data.content.items.unshift({ id: J.uid(), platform: "general", type: "Research brief", title: "Research: " + topic, body: text, status: "draft", created: Date.now() }); J.save("content");
      const summary = (text.split(/\n(?=[A-Z][A-Z &()0-9,-]{3,}\n)/)[0] || "").replace(/^SUMMARY\s*/, "").replace(/\s+/g, " ").slice(0, 320);
      J.say(`The research brief on ${topic} is ready. ${summary}`, { log: false });
    } catch (e) { out.replaceChildren(el("p", e.message, "err")); }
    go.disabled = false; go.textContent = "Research";
  };
  function reportView(topic, text) {
    const wrap = el("div", null, "report");
    wrap.append(el("h3", topic));
    for (const line of text.split(/\n/)) { const l = line.trim(); if (!l) continue;
      if (/^[A-Z][A-Z &()0-9,-]{3,}$/.test(l)) wrap.append(el("h4", l)); else if (/^- /.test(l)) wrap.append(el("p", "• " + l.slice(2), "bullet")); else wrap.append(el("p", l)); }
    const r = el("div", null, "row"); r.append(btn("Copy report", e => J.copy(text, e.target)), btn("Turn into a proposal", () => { J.go("content"); setTimeout(() => { $("ctype").value = "proposal"; $("ctopic").value = "Based on this research:\n" + text.slice(0, 3000); }, 50); }));
    wrap.append(el("p", "Saved to your Content library. Written from Claude's knowledge, without live web access: check current figures with the sources listed.", "muted"), r);
    return wrap;
  }

  // ======================= SOCIAL & APPS
  J.renderSocial = () => {
    const box = $("socialBody"); box.replaceChildren();
    const s = section("Social media control center", "what works today, honestly");
    J.PLATFORMS.filter(p => p.group === "Social" || p.group === "Google").forEach(p => {
      const c = el("div", null, "platform"); const h = el("div", null, "row spread");
      const st = p.conn ? J.conn[p.conn].status : "manual";
      h.append(el("b", p.name), pill(p.conn ? statusLabel(st) : "Open & create only", p.conn ? statusKind(st) : ""));
      c.append(h, el("p", p.can || "", "muted"));
      if (p.needs) c.append(el("p", "Full integration needs: " + p.needs, "small"));
      const r = el("div", null, "row"); r.append(J.linkBtn("Open " + p.name, p.url));
      const ct = Object.entries(J.CONTENT_TYPES).find(([, v]) => v.platform === p.key);
      if (ct) r.append(btn("Create content", () => { J.go("content"); setTimeout(() => { $("ctype").value = ct[0]; $("ctopic").focus(); }, 50); }));
      c.append(r); s.append(c); });
    box.append(s);
    // launcher
    const l = section("App launcher", "say “open …” or tap");
    const q = el("input", null, "", { type: "search", id: "appsearch", placeholder: "Search apps", "aria-label": "Search apps" });
    const grid = el("div", null, "launch");
    const draw = () => { grid.replaceChildren(); J.allApps().filter(a => a.name.toLowerCase().includes(q.value.toLowerCase())).forEach(a => {
      const w = el("span", null, "appchip"); const link = J.linkBtn(a.name, a.url); link.onclick = () => J.noteRecent(a.key);
      const star = btn((J.data.settings.favorites || []).includes(a.key) ? "★" : "☆", () => { const f = J.data.settings.favorites = J.data.settings.favorites || [];
        const i = f.indexOf(a.key); if (i >= 0) f.splice(i, 1); else f.push(a.key); J.save("settings"); draw(); }, "mini star", { "aria-label": "Favourite " + a.name });
      w.append(link, star); if (a.custom) w.append(btn("✕", () => { J.data.settings.shortcuts = J.data.settings.shortcuts.filter(x => x.id !== a.id); J.save("settings"); draw(); }, "mini danger", { "aria-label": "Remove " + a.name }));
      grid.append(w); }); };
    q.oninput = draw; draw();
    const add = el("form", null, "row"); const nm = el("input", null, "", { type: "text", placeholder: "Name, e.g. Company CRM", "aria-label": "Shortcut name", id: "scname" });
    const url = el("input", null, "", { type: "url", placeholder: "https://…", "aria-label": "Shortcut address", id: "scurl" });
    add.append(nm, url, el("button", "Add shortcut", "btn", { type: "submit" }));
    add.onsubmit = e => { e.preventDefault(); if (!nm.value.trim() || !/^https?:\/\/\S+$/i.test(url.value.trim())) { J.toast("Give the shortcut a name and a full https:// address.", "bad"); return; }
      (J.data.settings.shortcuts = J.data.settings.shortcuts || []).push({ id: J.uid(), name: nm.value.trim(), url: url.value.trim() }); J.save("settings"); J.log("Shortcut added", nm.value); nm.value = url.value = ""; draw(); };
    const rec = (J.data.settings.recent || []).map(k => J.allApps().find(a => a.key === k)).filter(Boolean);
    l.append(q, grid, el("p", "★ marks favourites for Quick launch and Business mode. Recently opened: " + (rec.map(a => a.name).join(", ") || "none yet") + ".", "muted"), add,
      el("p", "Desktop programs and folders (Excel, Tally, your project folder) can only be opened by the Jarvis desktop app on your PC — see Connections.", "small"));
    box.append(l);
  };

  // ======================= WORKFLOWS
  J.renderFlows = () => {
    const box = $("flowsBody"); box.replaceChildren();
    const list = section("Workflows & modes", "run by voice: say the phrase");
    J.flows().forEach(f => { const c = el("div", null, "flow"); const h = el("div", null, "row spread");
      h.append(el("b", f.name), el("span", "“" + (f.phrase || f.name) + "”", "muted"));
      const steps = el("ol", null, "steps"); f.steps.forEach(s => steps.append(el("li", J.STEPS[s.type].label + (s.apps || s.title || s.prompt || s.text || s.section || s.minutes || s.question ? ": " + (s.apps || s.title || s.prompt || s.text || s.section || s.minutes || s.question) : ""))));
      const r = el("div", null, "row"); r.append(btn("Run", () => { J.go("home"); J.runFlow(f.id); }, "btn primary"), btn(f.builtin ? "Copy & edit" : "Edit", () => editFlow(f)));
      if (!f.builtin) r.append(btn("Delete", () => { J.deleteFlow(f.id); }, "btn danger"));
      c.append(h, steps, r); list.append(c); });
    list.append(btn("New workflow", () => editFlow(null), "btn primary"));
    box.append(list);
    const ed = el("div", null, "", { id: "floweditor" }); box.append(ed);
    const hist = section("Run history");
    const runs = J.data.flows.runs.slice(0, 12);
    if (!runs.length) hist.append(empty("No runs yet."));
    runs.forEach(r => { const d = el("details", null, "run"); const s = el("summary");
      s.append(el("span", r.name, "ttl"), pill(r.status, statusKind(r.status === "done" ? "connected" : r.status === "failed" ? "error" : r.status)), el("span", new Date(r.started).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }), "muted"));
      const ol = el("ol", null, "steps"); r.steps.forEach(st => { const li = el("li"); li.append(pill(st.status, st.status === "done" ? "ok" : st.status === "failed" ? "bad" : st.status === "partial" ? "warn" : ""), document.createTextNode(" " + st.label + (st.note ? " — " + st.note : ""))); ol.append(li); });
      d.append(s, ol); if (r.status === "failed") d.append(btn("Retry from the failed step", () => { J.go("home"); J.retryRun(r); }, "btn primary"));
      hist.append(d); });
    box.append(hist);
  };
  function editFlow(f) {
    const ed = $("floweditor"); ed.replaceChildren();
    const draft = f && !f.builtin ? JSON.parse(JSON.stringify(f)) : { id: "f" + J.uid(), name: f ? f.name + " (my version)" : "", phrase: "", steps: f ? JSON.parse(JSON.stringify(f.steps)) : [{ type: "briefing" }] };
    const s = section(f && !f.builtin ? "Edit workflow" : "New workflow", "steps run in order; a failed step stops the run");
    const nm = el("input", null, "", { type: "text", id: "fname", placeholder: "Name, e.g. Start my workday", "aria-label": "Workflow name" }); nm.value = draft.name;
    const ph = el("input", null, "", { type: "text", id: "fphrase", placeholder: "Voice phrase, e.g. start my workday", "aria-label": "Voice phrase" }); ph.value = draft.phrase || "";
    const steps = el("ol", null, "editsteps");
    const draw = () => { steps.replaceChildren(); draft.steps.forEach((st, i) => { const li = el("li");
      const sel = el("select", null, "", { "aria-label": "Step " + (i + 1) }); for (const k in J.STEPS) sel.append(el("option", J.STEPS[k].label, "", { value: k })); sel.value = st.type;
      sel.onchange = () => { draft.steps[i] = { type: sel.value }; draw(); }; li.append(sel);
      for (const [k, label] of Object.entries(J.STEPS[st.type].fields || {})) { const inp = el("input", null, "", { type: "text", placeholder: label, "aria-label": label }); inp.value = st[k] || ""; inp.oninput = () => st[k] = inp.value; li.append(inp); }
      li.append(btn("↑", () => { if (i) { [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; draw(); } }, "mini", { "aria-label": "Move up" }),
        btn("✕", () => { draft.steps.splice(i, 1); draw(); }, "mini danger", { "aria-label": "Remove step" }));
      steps.append(li); }); };
    draw();
    const r = el("div", null, "row");
    r.append(btn("Add step", () => { draft.steps.push({ type: "say", text: "" }); draw(); }), btn("Save workflow", () => {
      draft.name = nm.value.trim(); draft.phrase = ph.value.trim().toLowerCase();
      if (!draft.name || !draft.steps.length) { J.toast("Give the workflow a name and at least one step.", "bad"); return; }
      J.saveFlow(draft); ed.replaceChildren(); J.toast("Saved. Say “" + (draft.phrase || "run " + draft.name) + "” to run it.", "ok"); }, "btn primary"), btn("Close", () => ed.replaceChildren()));
    s.append(nm, ph, steps, r,
      el("p", "Workflows run while Jarvis is open. Steps that change your accounts always wait for your approval.", "muted"));
    ed.append(s); nm.focus();
  }

  // ======================= INVESTING (preserved from version 1)
  J.renderInvest = () => {
    const box = $("investBody"); box.replaceChildren();
    const snap = J.snapshot();
    const p = section("Portfolio", snap.rows.length ? `${J.money(snap.val, 0)} · ${J.pct(snap.pnlPct)}` : "");
    if (snap.rows.length) { p.append(J.table(J.holdingsPanel(snap)));
      const stale = snap.rows.filter(r => r.at && r.at < J.today()).map(r => r.s); if (stale.length) p.append(el("p", "Prices from an earlier day: " + stale.join(", ") + ". Say “Reliance is at 2958” to update.", "warn small")); }
    else p.append(empty("No holdings yet. Say “I bought 10 shares of Reliance at 2900”."));
    p.append(el("p", "The web version can't read live exchange prices. The desktop app fetches them automatically.", "muted"));
    box.append(p);
    const w = section("Watchlist"); const g = el("div", null, "launch");
    J.data.state.watchlist.forEach(s => { const l = J.LINK.quote(s); g.append(J.linkBtn(s + (J.data.state.prices[s] ? " · " + J.money(J.data.state.prices[s].price) : ""), l.href)); });
    w.append(J.data.state.watchlist.length ? g : empty("Say “add Infosys to my watchlist”.")); box.append(w);
    const c = section("Calculators"); const r = el("div", null, "chips");
    ["SIP of 10,000 a month for 15 years at 12 percent", "Lump sum of 5 lakh for 10 years at 12 percent", "CAGR from 100 to 250 in 5 years", "Realised profit"].forEach(x => r.append(btn(x, () => J.send(x), "chip")));
    c.append(r); box.append(c);
  };

  // ======================= CONNECTIONS
  const statusLabel = s => ({ connected: "Connected", ready: "Ready — asks permission on first use", checking: "Checking…", auth: "Needs sign-in", error: "Error", unavailable: "Not available here" }[s] || s);
  const statusKind = s => ({ connected: "ok", ready: "", auth: "warn", error: "bad", unavailable: "bad", failed: "bad", partial: "warn", running: "", paused: "warn", stopped: "" }[s] || "");
  J.renderConnections = () => {
    const box = $("connBody"); box.replaceChildren();
    const g = section("Connected through your Claude account", "no passwords or tokens are stored in Jarvis");
    for (const k in J.conn) { const c = J.conn[k], p = J.PLATFORMS.find(x => x.conn === k);
      const d = el("div", null, "platform"); const h = el("div", null, "row spread"); h.append(el("b", c.name), pill(statusLabel(c.status), statusKind(c.status)));
      d.append(h, el("p", p.can, "muted"), el("p", c.detail + (c.lastSync ? " · last used " + new Date(c.lastSync).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""), "small"));
      const r = el("div", null, "row");
      r.append(btn("Test connection", async e => { e.target.disabled = true; try {
        if (k === "gmail") await J.gmail.search("in:inbox", 1); if (k === "calendar") await J.calendar.list(null, null, 1); if (k === "drive") await J.drive.search("", 1);
        J.toast(c.name + " is working.", "ok"); } catch (x) { J.toast(x.message, "bad"); } e.target.disabled = false; J.renderConnections(); }));
      r.append(J.linkBtn("Manage in claude.ai", "https://claude.ai/settings/connectors"));
      d.append(r); g.append(d); }
    g.append(el("p", "To disconnect, use claude.ai → Settings → Connectors, or this page's Permissions menu.", "muted"));
    box.append(g);
    const n = section("Not yet integrated", "these need an approved developer app and a server; Jarvis won't pretend");
    J.PLATFORMS.filter(p => p.needs).forEach(p => { const d = el("div", null, "platform"); const h = el("div", null, "row spread"); h.append(el("b", p.name), pill("Not integrated", "bad"));
      d.append(h, el("p", "Today: " + p.can, "muted"), el("p", "Needs: " + p.needs, "small")); n.append(d); });
    box.append(n);
    const dsk = section("Jarvis desktop app (Windows)", "for live prices, wake word and opening programs");
    dsk.append(el("p", "Programs and folders on your PC can't be opened from a web page. The desktop app in your GitHub repo can: it opens apps, folders and websites you register in config.json, listens for “Jarvis” hands-free, and fetches live NSE/BSE prices, news and weather."),
      J.linkBtn("Download from GitHub", "https://github.com/parshwanathaif/Parshwanath-Jarvis"));
    box.append(dsk);
  };

  // ======================= ACTIVITY
  J.renderActivity = () => {
    const box = $("activityBody"); box.replaceChildren();
    const ap = section("Approvals", "nothing that changes your accounts happens without your click");
    if (!J.approvals.length) ap.append(empty("Nothing waiting."));
    J.approvals.slice().reverse().forEach(a => ap.append(approvalCard(a))); box.append(ap);
    const lg = section("Activity log", "everything Jarvis has done");
    const items = J.data.activity.items.slice(0, 120);
    lg.append(items.length ? J.table({ title: "", columns: ["When", "Action", "Status", "Detail"], rows: items.map(i => [new Date(i.t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), i.action, i.status, i.detail]) }) : empty("No activity yet."));
    lg.append(btn("Clear activity log", () => { J.wipe("activity"); J.renderActivity(); }, "btn danger"));
    box.append(lg);
  };

  // ======================= SETTINGS
  J.renderSettings = () => {
    const box = $("settingsBody"); box.replaceChildren(); const s = J.data.settings;
    const lab = (t, c) => { const l = el("label", null, "field"); l.append(el("span", t), c); return l; };
    const me = section("You");
    const nm = el("input", null, "", { type: "text", id: "sname", placeholder: "How Jarvis greets you", "aria-label": "Your name" }); nm.value = s.name || ""; nm.onchange = () => { s.name = nm.value.trim(); J.save("settings"); };
    const bz = el("input", null, "", { type: "text", id: "sbiz", placeholder: "Parshwanath Life Science — pharma / chemicals trading and export, India", "aria-label": "Your business" }); bz.value = s.business || ""; bz.onchange = () => { s.business = bz.value.trim(); J.save("settings"); };
    me.append(lab("Your name", nm), lab("Your business (used for content and research)", bz)); box.append(me);
    const v = section("Voice");
    const eng = el("select", null, "", { id: "sengine", "aria-label": "Reply voice" }); [["", "Automatic"], ["claude", "Claude voice"], ["computer", "Computer voice"]].forEach(([k, l]) => eng.append(el("option", l, "", { value: k })));
    eng.value = s.engine || ""; eng.onchange = () => { s.engine = eng.value; J.voice.broken = false; J.save("settings"); };
    const vs = el("select", null, "", { id: "svoice", "aria-label": "Computer voice" }); vs.append(el("option", "Default", "", { value: "" }));
    J.voice.listVoices().forEach(x => vs.append(el("option", `${x.name} (${x.lang})`, "", { value: x.name }))); vs.value = s.voiceName || ""; vs.onchange = () => { s.voiceName = vs.value; J.save("settings"); };
    const rate = el("input", null, "", { type: "range", id: "srate", min: "0.7", max: "1.5", step: "0.05", "aria-label": "Speaking speed" }); rate.value = s.rate || 1;
    const rv = el("span", (+rate.value).toFixed(2) + "×", "muted"); rate.oninput = () => { s.rate = +rate.value; rv.textContent = (+rate.value).toFixed(2) + "×"; J.save("settings"); };
    const lang = el("select", null, "", { id: "slang", "aria-label": "Listening language" }); [["", "My browser's language"], ["en-IN", "English (India)"], ["en", "English"], ["hi", "Hindi / Hinglish"]].forEach(([k, l]) => lang.append(el("option", l, "", { value: k })));
    lang.value = s.language || ""; lang.onchange = () => { s.language = lang.value; J.save("settings"); };
    const rr = el("div", null, "row"); rr.append(rate, rv);
    v.append(lab("Reply voice", eng), lab("Computer voice", vs), lab("Speaking speed", rr), lab("Listening language", lang),
      el("div", null, "row"), btn("Test speaker", J.voice.test), btn(J.voice.muted ? "Voice replies: off" : "Voice replies: on", e => { J.voice.muted = !J.voice.muted; e.target.textContent = "Voice replies: " + (J.voice.muted ? "off" : "on"); if (J.voice.muted) J.voice.stopSpeaking(); }),
      el("p", "Hands-free “Hey Jarvis” isn't possible in a web page: the browser needs a click each time listening starts. The desktop app has an always-listening wake word.", "muted"));
    box.append(v);
    const m = section("Memory", "off unless you turn it on");
    const mc = el("input", null, "", { type: "checkbox", id: "smem" }); mc.checked = J.data.memory.enabled;
    mc.onchange = () => { J.data.memory.enabled = mc.checked; J.save("memory"); J.log("Memory", mc.checked ? "Long-term memory on" : "Long-term memory off"); };
    const ml = el("label", null, "chk"); ml.append(mc, document.createTextNode(" Remember facts I ask you to remember, across sessions"));
    m.append(ml);
    const items = J.data.memory.items.concat(J.data.memory.notes.map(n => ({ text: n.text, legacy: true })));
    const ul = el("ul", null, "list"); items.forEach(i => { const li = el("li"); li.append(el("span", i.text, "grow"), btn("Forget", () => {
      if (i.legacy) J.data.memory.notes = J.data.memory.notes.filter(n => n.text !== i.text); else J.data.memory.items = J.data.memory.items.filter(x => x !== i);
      J.save("memory"); J.renderSettings(); }, "mini danger")); ul.append(li); });
    m.append(items.length ? ul : empty("Nothing remembered.")); box.append(m);
    const d = section("Your data", J.storage === "account" ? "saved privately in your Claude account" : "saved on this device only");
    const confirmRow = el("div", null, "row");
    const wipe = (label, names) => btn(label, () => { confirmRow.replaceChildren(el("span", `Delete ${label.toLowerCase().replace("delete ", "")}? This can't be undone.`, "err"),
      btn("Yes, delete", () => { names.forEach(n => J.wipe(n)); J.log("Data deleted", label); confirmRow.replaceChildren(); J.toast("Deleted.", "ok"); J.renderSettings(); }, "btn danger"), btn("Keep", () => confirmRow.replaceChildren())); }, "btn danger");
    const r = el("div", null, "row"); r.append(wipe("Delete tasks", ["tasks"]), wipe("Delete content library", ["content"]), wipe("Delete workflows & history", ["flows"]),
      wipe("Delete memory", ["memory"]), wipe("Delete everything", ["tasks", "content", "flows", "memory", "activity", "state", "settings"]));
    d.append(r, confirmRow); box.append(d);
  };

  // ======================= HELP
  J.HELP = [["Start", "Jarvis, start my business work · activate business mode · daily briefing · what should I focus on today?"],
    ["Apps", "open WhatsApp · open Instagram · open my business apps · search for AI automation trends on YouTube"],
    ["Tasks", "remind me to call the client tomorrow at 11 am · create a task to prepare the marketing campaign · what are my tasks today · mark task 1 done"],
    ["Email & calendar", "summarise my important emails · any email from Anupam Rasayan? · what's on my calendar tomorrow · schedule a call with Meet on Friday at 4 pm"],
    ["Content", "create five Instagram post ideas for my business · prepare a YouTube script about AI in pharma · write a LinkedIn post about our new export range"],
    ["Research", "research the current opportunities in digital marketing · research mode"],
    ["Workflows", "focus mode for 45 minutes · content mode · run start my workday"],
    ["Investing", "I bought 10 shares of Reliance at 2900 · how is my portfolio · SIP of 10,000 a month for 15 years"],
    ["Memory", "remember that our GST filing is due on the 20th · what do you remember"],
    ["Voice", "switch to Friday · stop"]];
  J.renderHelp = () => { const box = $("helpBody"); box.replaceChildren(); const s = section("What to say"); s.append(J.table({ title: "", columns: ["Area", "Try saying"], rows: J.HELP })); box.append(s); };
})(window.J);
