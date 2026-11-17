/* Jarvis web — workflows: modes and your own multi-step routines, with approval checkpoints, history and retry. */
"use strict";
(function (J) {
  // Each step type: label, fields it takes, and what it does. Steps report what really happened.
  J.STEPS = {
    briefing: { label: "Give the daily briefing", run: async (p, ctx) => { const b = await J.briefing(); ctx.show({ briefing: b }); await J.say(b.speech, { log: false }); return b.errors.length ? { partial: b.errors.join("; ") } : "Briefing given"; } },
    tasks: { label: "Read today's priority tasks", run: async (p, ctx) => { const t = J.tasksDue("today"); ctx.show({ view: "tasks" });
      await J.say(t.length ? `Priority today: ${t.slice(0, 3).map(x => x.title).join(", ")}.` : "No tasks due today.", { log: false }); return `${t.length} tasks`; } },
    calendar: { label: "Show today's calendar", run: async (p, ctx) => { const now = new Date(), end = new Date(now); end.setHours(23, 59);
      const ev = await J.calendar.list(J.localIso(now), J.localIso(end)); ctx.show({ events: ev }); return `${ev.length} events`; } },
    email: { label: "List unread important email", run: async (p, ctx) => { const m = await J.gmail.search(p.query || "in:inbox is:unread newer_than:2d -category:promotions -category:social", 10);
      ctx.show({ mail: m }); return `${m.length} unread`; } },
    emailSummary: { label: "Summarise unread email with AI", run: async (p, ctx) => { const r = await J.agent("Summarise my unread inbox email from the last two days: group by priority, say which need a reply, in under 6 sentences.");
      ctx.show({ reply: r }); await J.say(r.speech, { log: false }); return "Summary given"; } },
    apps: { label: "Show app shortcuts", fields: { apps: "App names, comma separated" }, run: async (p, ctx) => {
      const names = String(p.apps || "").split(",").map(s => s.trim()).filter(Boolean);
      const apps = (names.length ? names.map(J.findApp) : (J.data.settings.favorites || []).map(k => J.allApps().find(a => a.key === k))).filter(Boolean);
      ctx.show({ links: apps.map(J.launchCard) }); return `${apps.length} shortcuts shown (browsers need your click to open each one)`; } },
    view: { label: "Go to a section", fields: { section: "home, tasks, content, research, social, flows, invest, connections, activity, prefs" },
      run: async (p) => { J.go(p.section || "home"); return "Opened " + (p.section || "home"); } },
    task: { label: "Create a task", fields: { title: "Task, e.g. Call supplier tomorrow at 11 am" }, run: async p => { const t = J.taskFromSpeech(p.title || "Untitled task"); return "Task: " + t.title; } },
    ask: { label: "Ask the AI", fields: { prompt: "What to ask" }, run: async (p, ctx) => { const r = await J.agent(p.prompt || "What should I focus on today?"); ctx.show({ reply: r }); await J.say(r.speech, { log: false }); return "Answered"; } },
    say: { label: "Say something", fields: { text: "What Jarvis says" }, run: async p => { await J.say(p.text || "", { log: false }); return "Spoken"; } },
    focus: { label: "Start a focus timer", fields: { minutes: "Minutes (default 25)" }, run: async p => { J.startFocus(Number(p.minutes) || 25); return `Focus timer: ${Number(p.minutes) || 25} minutes`; } },
    approve: { label: "Wait for my approval", fields: { question: "Question to ask before continuing" }, checkpoint: true },
  };

  // Built-in modes (editable copies can be made from them)
  J.BUILTIN = [
    { id: "business", name: "Business mode", phrase: "activate business mode", builtin: true, steps: [
      { type: "briefing" }, { type: "apps", apps: "" }, { type: "approve", question: "Shall I summarise your unread email?" }, { type: "emailSummary" }] },
    { id: "focus", name: "Focus mode", phrase: "focus mode", builtin: true, steps: [{ type: "tasks" }, { type: "focus", minutes: "25" }] },
    { id: "content", name: "Content mode", phrase: "content mode", builtin: true, steps: [{ type: "view", section: "content" }, { type: "say", text: "Content studio is open. Pick a format and a topic, or tell me what to create." }] },
    { id: "research", name: "Research mode", phrase: "research mode", builtin: true, steps: [{ type: "view", section: "research" }, { type: "say", text: "Research mode. What would you like me to research?" }] },
  ];
  J.flows = () => J.BUILTIN.concat(J.data.flows.custom);
  J.findFlow = name => { const n = String(name).toLowerCase().trim();
    return J.flows().find(f => f.id === n || f.name.toLowerCase() === n || (f.phrase || "").toLowerCase() === n) || J.flows().find(f => f.name.toLowerCase().includes(n) && n.length > 3) || null; };

  // ---- runner
  J.activeRun = null;
  J.runFlow = async (id, opts = {}) => {
    const flow = J.flows().find(f => f.id === id); if (!flow) return;
    const run = opts.resume || { id: J.uid(), flow: flow.id, name: flow.name, started: Date.now(), status: "running", steps: flow.steps.map(s => ({ type: s.type, label: J.STEPS[s.type].label, status: "waiting", note: "" })) };
    if (!opts.resume) { J.data.flows.runs.unshift(run); J.data.flows.runs.length = Math.min(J.data.flows.runs.length, 40); J.log("Workflow started", flow.name, "running"); }
    run.status = "running"; J.activeRun = run; J.save("flows"); J.emit("flows");
    const ctx = { show: x => J.emit("flowshow", x) };
    for (let i = opts.from || 0; i < flow.steps.length; i++) {
      const step = flow.steps[i], st = run.steps[i], def = J.STEPS[step.type];
      st.status = "running"; J.emit("flows"); J.voice.state("executing", def.label);
      if (def.checkpoint) {
        st.status = "approval"; run.status = "paused"; J.save("flows"); J.emit("flows");
        const q = step.question || "Continue?";
        J.requestApproval({ title: `${flow.name}: ${q}`, detail: "", run: async () => { st.status = "done"; st.note = "Approved"; J.runFlow(id, { resume: run, from: i + 1 }); return ""; } });
        const a = J.approvals[J.approvals.length - 1];
        J.on("approvals", x => { if (x === a && x.status === "cancelled" && st.status === "approval") { st.status = "skipped"; st.note = "You said no"; run.status = "stopped"; J.save("flows"); J.emit("flows"); } });
        await J.say(q, { log: false });
        J.ctx.pending = { yes: async () => { J.decide(a, true); return { speech: "Continuing." }; }, no: async () => { J.decide(a, false); return { speech: "Okay, stopping there." }; } };
        return run;
      }
      try {
        const r = await def.run(Object.assign({}, step, opts.params || {}), ctx);
        if (r && r.partial) { st.status = "partial"; st.note = r.partial; } else { st.status = "done"; st.note = r || ""; }
      } catch (e) {
        st.status = "failed"; st.note = e.message; run.status = "failed"; run.failedAt = i; J.save("flows"); J.emit("flows");
        J.log("Workflow step failed", `${flow.name} → ${def.label}: ${e.message}`, "failed");
        J.voice.state("error"); await J.say(`${def.label} failed. ${e.message} You can retry it from Workflows.`, { log: false });
        return run;
      }
      J.save("flows"); J.emit("flows");
    }
    run.status = run.steps.some(s => s.status === "partial") ? "partial" : "done"; run.ended = Date.now();
    J.save("flows"); J.emit("flows"); J.log("Workflow finished", flow.name, run.status); J.voice.state("done");
    J.activeRun = null; return run;
  };
  J.retryRun = run => { const flow = J.flows().find(f => f.id === run.flow); if (!flow) return;
    for (let i = run.failedAt; i < run.steps.length; i++) { run.steps[i].status = "waiting"; run.steps[i].note = ""; }
    J.runFlow(flow.id, { resume: run, from: run.failedAt }); };
  J.runFlowReply = async (id, params) => {
    const f = J.flows().find(x => x.id === id);
    setTimeout(() => J.runFlow(id, { params }), 50);
    return { speech: id === "business" ? "" : `${f.name} activated.`, silent: id === "business", view: id === "business" ? "home" : null };
  };
  J.briefingReply = async () => { const b = await J.briefing(); J.emit("flowshow", { briefing: b }); return { speech: b.speech, view: "home" }; };

  J.saveFlow = flow => { const list = J.data.flows.custom, i = list.findIndex(f => f.id === flow.id);
    if (i >= 0) list[i] = flow; else list.push(flow); J.save("flows"); J.emit("flows"); J.log("Workflow saved", flow.name); };
  J.deleteFlow = id => { J.data.flows.custom = J.data.flows.custom.filter(f => f.id !== id); J.save("flows"); J.emit("flows"); };

  // ---- focus timer
  let focusTimer = null;
  J.startFocus = minutes => {
    clearInterval(focusTimer); const end = Date.now() + minutes * 60000; document.body.classList.add("focus");
    J.log("Focus session", minutes + " minutes", "running");
    const tick = () => { const left = Math.max(0, end - Date.now()), el = J.$("focusclock");
      if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
      if (!left) { clearInterval(focusTimer); document.body.classList.remove("focus"); J.say("Focus session complete. Take a short break."); J.log("Focus session", "complete", "done"); } };
    tick(); focusTimer = setInterval(tick, 1000);
  };
  J.stopFocus = () => { clearInterval(focusTimer); document.body.classList.remove("focus"); J.log("Focus session", "stopped early", "cancelled"); };
})(window.J);
