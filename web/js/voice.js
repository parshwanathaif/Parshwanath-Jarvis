/* Jarvis web — voice: dictation in, Claude or computer voice out, with a visible voice check. */
"use strict";
(function (J) {
  const V = J.voice = { dict: null, tts: null, listening: false, speaking: false, heard: "", lastPartial: "", gotWords: false, broken: false, muted: false, userStopped: false };
  const IN_CLAUDE_APP = /Electron|Claude/i.test(navigator.userAgent);
  const MIC_MSG = {
    not_granted: "The microphone is blocked for this page. Use “Fix microphone”, and allow the microphone in the browser's address bar.",
    dismissed: "You closed the microphone question. Click the reactor to be asked again.",
    unavailable: "Voice input isn't offered here. Use Chrome or Edge on a computer, or the main window of the Claude desktop app, signed in to your account.",
    rate_limited: "Voice input is busy. Wait a few seconds and try again.",
    upstream_error: "The microphone or the speech service failed. Check that a microphone is connected and selected, then try again.",
    no_gesture: "Click the reactor itself to start listening.",
    time_limit: "Listening stopped after an hour. Click to start again.",
  };
  V.diag = (text, kind) => {
    const list = J.$("diaglist"); if (!list) return;
    list.append(J.el("li", new Date().toLocaleTimeString("en-IN", { hour12: false }) + "  " + text, kind || ""));
    while (list.children.length > 40) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  };
  const hint = t => { const h = J.$("hint"); if (h) h.textContent = t; };
  V.engine = () => J.data.settings.engine || (IN_CLAUDE_APP ? "computer" : "claude");

  // ---- orb state: idle | listening | processing | speaking | executing | done | error
  V.state = (name, label) => {
    const orb = J.$("orb"); if (!orb) return;
    orb.dataset.state = name; J.$("orbstate").textContent = label || { idle: "Standing by", listening: "Listening", processing: "Thinking", speaking: "Speaking",
      executing: "Working", done: "Done", error: "Something went wrong" }[name] || name;
    if (name === "done" || name === "error") setTimeout(() => { if (orb.dataset.state === name) V.state("idle"); }, 2500);
  };

  // ---- speech out
  const wait = J.wait;
  function browserVoices() { return ("speechSynthesis" in window && speechSynthesis.getVoices()) || []; }
  V.listVoices = () => browserVoices().filter(v => /^(en|hi)/i.test(v.lang));
  function pickVoice(lang) {
    const vs = browserVoices(), want = J.data.settings.voiceName;
    return vs.find(v => v.name === want) || vs.find(v => lang && v.lang.toLowerCase().startsWith(lang)) || vs.find(v => /en-IN/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
  }
  async function speakBrowser(text) {
    if (!("speechSynthesis" in window)) { V.diag("Computer voice: not available in this browser", "bad"); return false; }
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); await wait(200); }
    if (!browserVoices().length) await wait(400);
    return new Promise(done => {
      const u = new SpeechSynthesisUtterance(text.replace(/₹\s?/g, "rupees ").replace(/%/g, " percent"));
      const v = pickVoice(/[ऀ-ॿ]/.test(text) ? "hi" : ""); if (v) u.voice = v;
      u.rate = Number(J.data.settings.rate) || 1;
      let ended = false; const fin = ok => { if (!ended) { ended = true; done(ok); } };
      u.onstart = () => V.diag("Computer voice speaking" + (v ? " (" + v.name + ")" : ""), "ok");
      u.onend = () => fin(true);
      u.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") V.diag("Computer voice error: " + e.error, "bad"); fin(false); };
      setTimeout(() => fin(true), Math.max(6000, text.length * 130 / (u.rate || 1)));
      if (!browserVoices().length) V.diag("Computer voice: Windows reports no voices installed", "bad");
      speechSynthesis.speak(u);
    });
  }
  async function sayIt(text) {
    V.userStopped = false;
    for (let i = 0; i < 30 && V.dict && V.dict.active(); i++) await wait(100);   // never talk over the microphone
    if (V.engine() === "computer" || !V.tts || V.broken) return (await speakBrowser(text)) ? "spoken" : "failed";
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await V.tts.speak(text, { rate: Math.min(1.5, Math.max(0.7, Number(J.data.settings.rate) || 1)) }); return "spoken"; }
      catch (e) {
        const code = e && e.code;
        if (code === "stopped") { const why = e.reason || "stopped"; if (V.userStopped || why === "replaced") return "stopped";
          V.diag("Claude voice was cut off (" + why + "); using the computer voice", "bad"); V.broken = true; break; }
        if (code === "busy" && attempt === 0) { await wait(900); continue; }
        if (code === "not_granted") { V.broken = true; V.diag("Read aloud is off for this page (Permissions menu).", "bad"); return "off"; }
        V.diag("Claude voice failed: " + (code || "?") + "; using the computer voice", "bad"); V.broken = true; break;
      }
    }
    return (await speakBrowser(text)) ? "spoken" : "failed";
  }
  V.speak = async text => {
    if (V.muted || !text) return;
    V.speaking = true; V.state("speaking");
    await sayIt(String(text).slice(0, 1800));
    V.speaking = false; if (J.$("orb").dataset.state === "speaking") V.state("idle");
  };
  V.stopSpeaking = () => { V.userStopped = true; try { V.tts && V.tts.stop(); } catch (_) {} try { window.speechSynthesis && speechSynthesis.cancel(); } catch (_) {} V.speaking = false; V.state("idle"); };
  V.test = async () => {
    if (V.speaking) return;
    if (V.listening && V.dict) await V.dict.stop().catch(() => {});
    V.diag("Speaker test started; don't click anything for 10 seconds");
    V.speaking = true; V.state("speaking", "Testing speaker");
    const r = await sayIt("Speaker test. If you can hear me, voice replies are working.");
    V.speaking = false; V.state("idle");
    V.diag("Speaker test result: " + r, r === "spoken" ? "ok" : "bad");
  };

  // ---- speech in
  let silenceTimer = null;
  const armSilence = () => { clearTimeout(silenceTimer); silenceTimer = setTimeout(() => { if (V.listening && V.dict) V.dict.stop().catch(() => {}); }, 3000); };
  V.toggleMic = () => {
    if (V.speaking) { V.stopSpeaking(); return; }
    if (!V.dict) { hint(MIC_MSG.unavailable + " You can type commands instead."); J.$("text").focus(); return; }
    if (V.listening) { V.dict.stop().catch(() => {}); return; }
    V.heard = ""; V.lastPartial = ""; V.gotWords = false;
    V.diag("Clicked: asking to start listening");
    const lang = J.data.settings.language;
    V.dict.start(lang ? { language: lang } : undefined).then(() => V.diag("Microphone is open", "ok")).catch(e => {
      const code = e && e.code;
      V.diag("Start refused: " + (code || "?") + (e && e.message ? " — " + e.message : ""), code === "stopped" ? "" : "bad");
      if (code === "stopped") return;
      if (code === "unavailable" && lang) { hint("Voice input isn't available in the language set in Settings. Switch it to “My browser's language”."); }
      else hint(MIC_MSG[code] || ("Voice input failed: " + ((e && e.message) || code || "unknown error")));
      if (code === "not_granted") J.$("fixmic").hidden = false;
      V.state("idle");
    });
  };
  function wire(d) {
    V.dict = d;
    d.onPartial(({ text }) => { if (text) { V.lastPartial = text; if (!V.gotWords) V.diag("Hearing words: “" + text.slice(0, 40) + "”", "ok"); V.gotWords = true; clearTimeout(silenceTimer); }
      hint((V.heard + " " + text).trim() || "Listening…"); });
    d.onFinal(({ text }) => { V.heard = V.heard ? V.heard + text : text.replace(/^\s+/, ""); V.gotWords = true; hint(V.heard); armSilence(); });
    d.onState(({ state, reason }) => {
      V.diag("Mic: " + state + (reason ? " (" + reason + ")" : ""), reason && MIC_MSG[reason] ? "bad" : "");
      V.listening = state !== "idle";
      if (state === "starting") { V.state("listening", "Starting mic"); hint("Allow the microphone if asked…"); }
      else if (state === "listening") { V.state("listening"); if (!V.gotWords) hint("Listening… I send when you pause."); }
      else if (state === "finishing") V.state("processing", "Finishing");
      else {
        clearTimeout(silenceTimer);
        const t = (V.heard.trim() || V.lastPartial.trim()); V.heard = ""; V.lastPartial = "";
        if (t && reason !== "hidden") { hint(""); J.send(t, { spoken: true }); return; }
        if (reason && MIC_MSG[reason]) { hint(MIC_MSG[reason]); if (reason === "not_granted") J.$("fixmic").hidden = false; }
        else if (reason === "stopped" || reason === "viewer_stopped") hint(V.gotWords ? "" : "I didn't catch anything. Click the reactor and try again.");
        V.state("idle");
      }
    });
  }
  V.fixMic = async () => {
    const perms = window.claude && window.claude.use ? await window.claude.use("permissions") : null;
    try { if (!perms) throw 0; await perms.manage(); const st = await perms.state("dictation");
      if (st === "granted" || st === "prompt") { J.$("fixmic").hidden = true; hint("Microphone allowed. Click the reactor and speak."); } else hint("The microphone is still off for this page.");
    } catch (_) { hint("Open this page's Permissions menu at the top and switch Dictation on."); }
  };

  V.init = async () => {
    const ua = navigator.userAgent, br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? (IN_CLAUDE_APP ? "Claude app" : "Chrome") : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other";
    V.diag("Browser: " + br + (/Windows/.test(ua) ? " on Windows" : ""), br === "Firefox" || br === "Safari" ? "bad" : "");
    if ("speechSynthesis" in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => J.emit("voices"); }
    if (!window.claude || !window.claude.use) { V.diag("Claude page tools missing; open the page on claude.ai", "bad"); hint("Voice input isn't available in this view. Type your command below."); return; }
    const [d, t] = await Promise.all([window.claude.use("dictation"), window.claude.use("tts")]);
    V.diag("Voice input: " + (d ? "offered" : "NOT offered in this view"), d ? "ok" : "bad");
    V.diag("Reply voice: " + (V.engine() === "computer" ? "computer voice" : "Claude voice") + (t ? "" : " (Claude voice not offered here)"));
    if (d) wire(d); else hint(MIC_MSG.unavailable + " You can type commands instead.");
    V.tts = t;
    if (t) t.onState(({ reason }) => { if (reason && !["completed", "replaced", "stopped"].includes(reason)) V.diag("Claude voice ended: " + reason, reason === "viewer_stopped" ? "" : "bad"); });
    const perms = await window.claude.use("permissions");
    if (d && perms) { const st = await perms.state("dictation"); V.diag("Dictation permission: " + st, st === "denied" ? "bad" : st === "granted" ? "ok" : "");
      if (st === "denied") { hint(MIC_MSG.not_granted); J.$("fixmic").hidden = false; } }
    J.emit("voiceready", !!d);
  };
})(window.J);
