/* Jarvis web — wiring: navigation, the command loop, conversation, startup. */
"use strict";
(function (J) {
  const { el, $ } = J;
  const VIEWS = { home: "Assistant", tasks: "Tasks & calendar", content: "Content studio", research: "Business intelligence", social: "Social & apps",
    flows: "Workflows", invest: "Investing", connections: "Connections", activity: "Activity", prefs: "Settings", help: "Help" };
  const RENDER = { home: () => J.renderHome(), tasks: () => J.renderTasks(), content: () => J.renderContent(), research: () => {}, social: () => J.renderSocial(),
    flows: () => J.renderFlows(), invest: () => J.renderInvest(), connections: () => J.renderConnections(), activity: () => J.renderActivity(), prefs: () => J.renderSettings(), help: () => J.renderHelp() };
  J.view = "home";
  J.go = (v, { push = true } = {}) => {
    if (!VIEWS[v]) v = "home";
    J.view = v;
    document.querySelectorAll("main > section.view").forEach(s => s.hidden = s.id !== "view-" + v);
    document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false"));
    try { RENDER[v](); } catch (e) { console.error(e); }
    if (push && location.hash !== "#" + v) { try { history.replaceState(null, "", v === "home" ? location.pathname + location.search : "#" + v); } catch (_) { location.hash = v; } }
  };
  window.addEventListener("hashchange", () => J.go(location.hash.slice(1) || "home", { push: false }));

  // ---- conversation
  const logBox = () => $("log");
  function addMsg(text, who, extra = {}) {
    const m = el("div", null, "msg " + who); m.append(document.createTextNode(text));
    const links = (extra.links || []).filter(Boolean);
    if (links.length || extra.goto) { const box = el("div", null, "links");
      links.forEach(l => box.append(J.linkBtn(l.label, l.href)));
      if (extra.goto) { const b = el("button", "Go to " + VIEWS[extra.goto], "go", { type: "button" }); b.onclick = () => J.go(extra.goto); box.append(b); }
      m.append(box); }
    logBox().append(m); logBox().scrollTop = logBox().scrollHeight; return m;
  }
  J.say = async (text, { log = true } = {}) => { if (!text) return; addMsg(text, "jarvis"); if (log) J.log("Spoke", text.slice(0, 120)); await J.voice.speak(text); };

  let busy = false;
  J.send = async (text, opts = {}) => {
    text = String(text || "").trim(); if (!text || busy) return;
    busy = true; addMsg(text, "you"); J.voice.state("processing");
    let reply;
    try {
      reply = await J.route(text);
      if (!reply) {
        const live = addMsg("…", "jarvis thinking");
        reply = await J.agent(J.cleanInput(text), { onText: t => { const last = t.split(/\n\s*\n/).pop(); live.firstChild.textContent = last || "…"; } });
        live.remove();
      }
    } catch (e) { console.error(e); reply = { speech: "Something went wrong while doing that: " + e.message }; J.voice.state("error"); }
    busy = false;
    if (reply.remember) J.ai.session.push(reply.remember);
    if (reply.ask) J.ctx.pending = reply.ask;
    const goto = reply.view && reply.view !== J.view ? reply.view : null;
    if (reply.speech) addMsg(reply.speech, "jarvis", { links: reply.links, goto: goto && goto !== "help" ? goto : null });
    else if (reply.links && reply.links.length) addMsg("", "jarvis", { links: reply.links });
    if (reply.panel) { const p = $("panel"); p.hidden = false; $("panelTitle").textContent = reply.panel.title; $("panelBody").replaceChildren(J.table(reply.panel)); }
    if (reply.events || reply.mail || reply.files) showData(reply);
    if (goto === "help") J.go("help");
    if (J.view !== "home") RENDER[J.view] && RENDER[J.view]();
    if (J.$("orb").dataset.state === "processing") J.voice.state(reply.speech ? "done" : "idle");
    if (reply.speech && !reply.silent) await J.voice.speak(reply.speech);
  };
  function showData(r) {
    const p = $("panel"); p.hidden = false; const body = $("panelBody"); body.replaceChildren();
    if (r.events) { $("panelTitle").textContent = "Calendar"; body.append(r.events.length ? J.table({ title: "", columns: ["When", "Event"], rows: r.events.map(e => [e.allDay ? J.niceDate(e.start.slice(0, 10)) : J.niceDate(J.localIso(new Date(e.start))), { text: e.title, href: e.url }]) }) : el("p", "No events.", "empty")); }
    if (r.mail) { $("panelTitle").textContent = "Email"; body.append(r.mail.length ? J.table({ title: "", columns: ["From", "Subject", "When"], rows: r.mail.map(m => [m.from, { text: m.subject, href: m.url }, J.niceDate(m.date ? J.localIso(new Date(m.date)) : "")]) }) : el("p", "No matching email.", "empty")); }
    if (r.files) { $("panelTitle").textContent = "Google Drive"; body.append(r.files.length ? J.table({ title: "", columns: ["File", "Type", "Modified"], rows: r.files.map(f => [{ text: f.title, href: f.url }, f.type, J.niceDate((f.modified || "").slice(0, 10))]) }) : el("p", "No matching files.", "empty")); }
  }

  // approvals appear in the conversation as cards that update in place
  const cards = new Map();
  J.on("approvals", a => {
    const fresh = J.approvalCard(a);
    if (cards.has(a.id)) cards.get(a.id).replaceWith(fresh); else { logBox().append(fresh); logBox().scrollTop = logBox().scrollHeight; }
    cards.set(a.id, fresh);
    if (J.view === "home") J.renderHome(); else if (J.view === "activity") J.renderActivity();
    J.$("navbadge").textContent = J.approvals.filter(x => x.status === "pending").length || "";
  });
  J.on("flowshow", x => { if (J.view !== "home") J.go("home"); J.showFlowOutput(x); });
  J.on("flows", () => { if (J.view === "flows") J.renderFlows(); });
  J.on("tasks", () => { if (J.view === "tasks") J.renderTasks(); if (J.view === "home") J.renderHome(); });
  J.on("content", () => { if (J.view === "home") J.renderHome(); });
  J.on("portfolio", () => { if (J.view === "invest") J.renderInvest(); });
  J.on("connections", () => { if (J.view === "connections") J.renderConnections(); renderStatus(); });
  J.on("data", () => RENDER[J.view] && RENDER[J.view]());
  J.on("storage", s => { J.storageState = s; renderStatus(); });
  J.on("ai", renderStatus);
  J.on("voices", () => { if (J.view === "prefs") J.renderSettings(); });
  J.on("persona", () => { $("brand").textContent = J.data.settings.persona === "friday" ? "F.R.I.D.A.Y" : "J.A.R.V.I.S"; });
  function renderStatus() {
    const parts = [J.storageState === "account" ? "Synced to your account" : J.storageState === "slow" ? "Account storage is slow" : "Saved on this device"];
    parts.push(J.ai.available ? "AI on" : "AI off");
    const g = Object.values(J.conn).filter(c => c.status === "connected" || c.status === "ready").length; parts.push(`${g}/3 Google connections`);
    $("status").textContent = parts.join(" · ");
  }

  // ---- wiring
  document.addEventListener("DOMContentLoaded", () => {});
  function boot() {
    const nav = $("nav");
    for (const k in VIEWS) { const b = el("button", VIEWS[k], "", { type: "button", "data-view": k }); if (k === "activity") b.append(el("span", "", "badge", { id: "navbadge" })); b.onclick = () => J.go(k); nav.append(b); }
    $("orb").onclick = J.voice.toggleMic;
    $("fixmic").onclick = J.voice.fixMic;
    $("testvoice").onclick = J.voice.test;
    $("mute").onclick = () => { J.voice.muted = !J.voice.muted; $("mute").textContent = "Voice replies: " + (J.voice.muted ? "off" : "on"); if (J.voice.muted) J.voice.stopSpeaking(); };
    $("form").onsubmit = e => { e.preventDefault(); const t = $("text").value; $("text").value = ""; J.send(t); };
    $("rform").onsubmit = e => { e.preventDefault(); J.runResearch(); };
    $("stopfocus").onclick = J.stopFocus;
    document.addEventListener("keydown", e => {
      const a = document.activeElement;
      if (e.code !== "Space" || e.repeat || (a && /INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY|A/.test(a.tagName))) return;
      e.preventDefault(); J.voice.toggleMic(); });
    for (const c of ["Daily briefing", "Activate business mode", "What are my tasks today", "Summarise my important emails", "Create five Instagram post ideas for my business", "Help"]) {
      const b = el("button", c, "chip", { type: "button" }); b.onclick = () => J.send(c); $("chips").append(b); }
    addMsg(`${J.greeting()}. I am Jarvis, your business assistant. Click the reactor and speak, or type below. Say help to see what I can do.`, "jarvis");
    J.go(location.hash.slice(1) || "home", { push: false });
    J.initStore().then(() => { J.emit("persona"); if (J.view === "home") J.renderHome(); });
    J.initConnectors(); J.initAI(); J.voice.init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window.J);
