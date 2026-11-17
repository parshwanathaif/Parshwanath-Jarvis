/* Jarvis web — productivity: tasks, natural-language dates, reminders, daily briefing, approvals. */
"use strict";
(function (J) {
  // ---- natural-language dates: "tomorrow", "on friday", "at 5 pm", "in 2 hours", "next week", "25 nov", "2026-12-01"
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  J.parseWhen = (text, now = new Date()) => {
    let t = " " + String(text).toLowerCase() + " ", d = null, time = null, used = [];
    const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); used.push(m[0].trim()); t = t.replace(m[0], " "); } return !!m; };
    take(/\bin (\d+|an?|one|two|three) (minute|min|hour|hr|day|week)s?\b/, m => {
      const n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1]] || +m[1], ms = { minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5 }[m[2]];
      const x = new Date(now.getTime() + n * ms); d = x; if (ms < 864e5) time = [x.getHours(), x.getMinutes()]; });
    take(/\b(day after tomorrow|tomorrow|today|tonight|this evening|this morning|next week|next month)\b/, m => {
      const x = new Date(now); const w = m[1];
      if (w === "tomorrow") x.setDate(x.getDate() + 1); else if (w === "day after tomorrow") x.setDate(x.getDate() + 2);
      else if (w === "next week") x.setDate(x.getDate() + 7); else if (w === "next month") x.setMonth(x.getMonth() + 1);
      if (w === "tonight" || w === "this evening") time = time || [19, 0]; if (w === "this morning") time = time || [9, 0];
      d = x; });
    take(/\b(?:on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, m => {
      const x = new Date(now), target = DAYS.indexOf(m[1]); let add = (target - x.getDay() + 7) % 7; if (add === 0) add = 7; if (/next/.test(m[0])) add += add < 7 ? 7 : 0;
      x.setDate(x.getDate() + add); d = x; });
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, m => { d = new Date(+m[1], +m[2] - 1, +m[3]); });
    take(/\b(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/, m => {
      const day = +(m[1] || m[4]), mon = MONTHS.indexOf(m[2] || m[3]); const x = new Date(now.getFullYear(), mon, day);
      if (x < new Date(now.getFullYear(), now.getMonth(), now.getDate())) x.setFullYear(x.getFullYear() + 1); d = x; });
    take(/\b(?:at |by |@ ?)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)\b|\bat (\d{1,2}):(\d{2})\b|\b(noon|midday|midnight)\b/, m => {
      if (m[6]) { time = m[6] === "midnight" ? [0, 0] : [12, 0]; return; }
      let h = +(m[1] || m[4]), mi = +(m[2] || m[5] || 0); const ap = (m[3] || "").replace(/\./g, "");
      if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; time = [h, mi]; });
    if (!d && !time) return null;
    if (!d) { d = new Date(now); if (time && (time[0] * 60 + time[1]) <= now.getHours() * 60 + now.getMinutes()) d.setDate(d.getDate() + 1); }
    if (time) { d.setHours(time[0], time[1], 0, 0); return { iso: J.localIso(d), hasTime: true, rest: t.trim().replace(/\s+/g, " "), used }; }
    return { iso: J.isoDate(d), hasTime: false, rest: t.trim().replace(/\s+/g, " "), used };
  };

  // ---- tasks
  const T = () => J.data.tasks.items;
  J.addTask = ({ title, due, priority, project, remind }) => {
    title = String(title || "").trim().replace(/^(to |that i (?:need|have) to |i need to |i have to )/i, "").replace(/[.\s]+$/, "");
    if (!title) throw new Error("The task needs a title.");
    const pr = /high|urgent|important|asap|critical/i.test(priority || "") ? "high" : /low|someday|whenever/i.test(priority || "") ? "low" : "medium";
    const item = { id: J.uid(), title: title[0].toUpperCase() + title.slice(1), due: due || "", priority: pr, project: project || "", done: false, created: Date.now(),
      remindAt: remind && due && due.length > 10 ? due : "", reminded: false };
    T().push(item); J.save("tasks"); J.emit("tasks");
    J.log("Task created", item.title + (item.due ? " · due " + J.niceDate(item.due) : ""), "done");
    return item;
  };
  J.taskFromSpeech = (text, opts = {}) => {
    const when = J.parseWhen(text);
    let title = when ? when.rest : text;
    title = title.replace(/\b(high|top|low) priority\b|\b(urgent|important|asap)\b/gi, " ").replace(/\s+/g, " ").trim();
    return J.addTask({ title, due: when ? when.iso : "", priority: (text.match(/\b(high|top|low) priority\b|\b(urgent|important|asap)\b/i) || [""])[0], remind: opts.remind || /remind/i.test(opts.source || "") });
  };
  J.findTask = q => {
    const items = T().filter(t => !t.done);
    if (/^\d+$/.test(String(q).trim())) return J.sortedTasks(items)[+q - 1] || null;
    const k = String(q).toLowerCase(); return items.find(t => t.title.toLowerCase() === k) || items.find(t => t.title.toLowerCase().includes(k)) || null;
  };
  J.completeTask = t => { t.done = true; t.doneAt = Date.now(); J.save("tasks"); J.emit("tasks"); J.log("Task completed", t.title); };
  J.deleteTask = t => { J.data.tasks.items = T().filter(x => x !== t); J.save("tasks"); J.emit("tasks"); J.log("Task deleted", t.title); };
  const PR = { high: 0, medium: 1, low: 2 };
  J.sortedTasks = (items = T().filter(t => !t.done)) => items.slice().sort((a, b) =>
    (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due || "").localeCompare(b.due || "") || PR[a.priority] - PR[b.priority] || a.created - b.created);
  J.tasksDue = (scope = "today") => {
    const t = J.today();
    const open = T().filter(x => !x.done);
    if (scope === "overdue") return J.sortedTasks(open.filter(x => x.due && x.due.slice(0, 10) < t));
    if (scope === "today") return J.sortedTasks(open.filter(x => x.due && x.due.slice(0, 10) <= t || (!x.due && x.priority === "high")));
    return J.sortedTasks(open);
  };

  // reminders fire while Jarvis is open; for phone-level reminders, add the task to Google Calendar
  setInterval(() => {
    const now = J.localIso(new Date());
    for (const t of T()) if (!t.done && t.remindAt && !t.reminded && t.remindAt <= now) {
      t.reminded = true; J.save("tasks");
      const msg = "Reminder: " + t.title + ".";
      J.toast(msg, "warn"); J.say(msg, { log: false }); J.log("Reminder", t.title, "done");
    }
  }, 30000);

  // ---- approvals: anything that changes an outside account waits for your click
  J.approvals = [];
  J.requestApproval = ({ title, detail, run }) => {
    const a = { id: J.uid(), title, detail, run, status: "pending" };
    a.log = J.log("Waiting for approval", title, "pending");
    J.approvals.push(a); J.emit("approvals", a); return a;
  };
  J.decide = async (a, ok) => {
    if (a.status !== "pending") return;
    if (!ok) { a.status = "cancelled"; J.setStatus(a.log, "cancelled", a.title + " (you cancelled)"); J.emit("approvals", a); return; }
    a.status = "running"; J.emit("approvals", a); J.setStatus(a.log, "running", a.title);
    try { const msg = await a.run(); a.status = "done"; a.result = msg; J.setStatus(a.log, "done", a.title + (msg ? " — " + msg : "")); J.say(msg || "Done.", {}); }
    catch (e) { a.status = "failed"; a.result = e.message; J.setStatus(a.log, "failed", a.title + " — " + e.message); J.say("That didn't work. " + e.message, {}); }
    J.emit("approvals", a);
  };

  // ---- daily briefing: tasks, calendar, mail, portfolio
  J.briefing = async ({ speak = true } = {}) => {
    const out = { tasks: J.tasksDue("today"), overdue: J.tasksDue("overdue"), events: null, mail: null, errors: [] };
    const now = new Date(), end = new Date(now); end.setHours(23, 59, 0, 0);
    const [ev, ml] = await Promise.allSettled([J.calendar.list(J.localIso(now), J.localIso(end), 15), J.gmail.search("in:inbox is:unread newer_than:2d -category:promotions -category:social", 8)]);
    if (ev.status === "fulfilled") out.events = ev.value; else out.errors.push(ev.reason.message);
    if (ml.status === "fulfilled") out.mail = ml.value; else out.errors.push(ml.reason.message);
    const parts = [`${J.greeting()}${J.data.settings.name ? ", " + J.data.settings.name : ""}.`];
    parts.push(out.events ? (out.events.length ? `You have ${out.events.length} event${out.events.length > 1 ? "s" : ""} left today, starting with ${out.events[0].title}${out.events[0].allDay ? "" : " at " + new Date(out.events[0].start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.` : "Your calendar is clear for the rest of today.") : "");
    parts.push(out.tasks.length ? `${out.tasks.length} task${out.tasks.length > 1 ? "s" : ""} need attention today${out.overdue.length ? `, ${out.overdue.length} overdue` : ""}. First: ${out.tasks[0].title}.` : "No tasks due today.");
    if (out.mail) parts.push(out.mail.length ? `${out.mail.length} unread email${out.mail.length > 1 ? "s" : ""} from the last two days, the latest from ${out.mail[0].from}.` : "No new unread email.");
    if (out.errors.length) parts.push("Some sources could not be read; details are on screen.");
    out.speech = parts.filter(Boolean).join(" ");
    J.data.settings.lastBriefing = J.today(); J.save("settings");
    J.log("Daily briefing", out.speech, out.errors.length ? "partial" : "done");
    return out;
  };
})(window.J);
