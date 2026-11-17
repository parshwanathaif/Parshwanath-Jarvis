# Jarvis — assessment, architecture and roadmap

Last updated: 17 November 2026.

## A. Assessment of the existing application

Jarvis exists in two forms, both in this repository.

| | Desktop app (`jarvis.py`, `jarvis/`) | Web app (`web/`, published at claude.ai) |
|---|---|---|
| Runs | On your PC, Python 3.9+, opens a local page at 127.0.0.1 | Inside claude.ai, signed in |
| Voice in | Chrome's speech recognition, plus an always-listening "Jarvis" wake word | Claude dictation: one click per command |
| Voice out | Browser voice | Claude voice or the computer's voice |
| Live market data | Yes (Yahoo Finance), plus news and weather | No: the page cannot reach outside services |
| Opens desktop programs and folders | Yes, for anything registered in `config.json` | No: browsers forbid it |
| Gmail, Google Calendar, Google Drive | No | Yes, through your Claude connectors |
| AI | Optional, with your own Anthropic API key | Built in, through your Claude account |
| Storage | `data/state.json` on your PC | Your Claude account, private to you, mirrored in the browser |

Limitations found before this upgrade (web version): one 600-line file; no task dates or priorities; no access to email, calendar or files; no approval step; no activity log; voice failures were silent. All of those are addressed below.

## B. Technology stack

- **Web app:** plain JavaScript modules (no build step), HTML and CSS, hosted as a claude.ai artifact. The platform provides sign-in, per-user private storage, Claude (with tool calling), dictation, text-to-speech and connectors. There is no server of ours to run or secure.
- **Desktop app:** Python standard library HTTP server and a browser-based screen. Optional `anthropic` and `psutil` packages.

React, TypeScript, Node and PostgreSQL were considered. They are not needed for what runs today: the platform already provides authentication, storage and AI. They become necessary at Phase 5b below, when Jarvis must hold its own OAuth tokens for Meta, YouTube or LinkedIn.

## C. Preserved features

Portfolio and P&L, watchlist, price updates by voice, SIP, lump-sum and CAGR calculators, notes (now "memory"), to-dos (now tasks), launcher, Jarvis/Friday switch, voice check. Data from the first web version is migrated automatically on first load.

## D. Implemented in this upgrade (web app)

| Area | What works now |
|---|---|
| Command engine | Fast built-in commands, then Claude with 14 tools (tasks, calendar, Gmail, Drive, app launcher, content library, memory, portfolio, workflows). Follow-ups work ("open YouTube" → "search for …" → "yes"). Asks a question when a request is ambiguous. |
| Voice | Dictation with auto-send on a 3-second pause; reply voice choice (Claude or computer), voice picker, speed, listening language (English, English-India, Hindi/Hinglish); orb states idle, listening, thinking, speaking, working, done, error; voice check log. |
| Tasks & reminders | Natural-language tasks ("call the client tomorrow at 11 am, high priority"), priorities, overdue tracking, reminders while Jarvis is open, "Add to Google Calendar" for phone reminders (with approval). |
| Google | Gmail search, read and summarise; Gmail drafts (never sent) after approval; Calendar read and create after approval; Drive search. |
| Daily briefing & modes | Briefing (calendar, tasks, unread mail) spoken and shown. Business, Focus (timer), Content and Research modes. |
| Workflows | Visual builder: 12 step types, voice phrase per workflow, approval checkpoints, run history with per-step status, retry from the failed step. |
| Content studio | 14 formats (Instagram captions and reels, YouTube scripts, packages and ideas, LinkedIn posts and messages, Facebook, WhatsApp templates, Telegram, email, ads, proposals, repurposing). Edit, approve, mark posted, plan dates, filter by platform, copy, save email as Gmail draft. |
| Business intelligence | Structured briefs (summary, findings, opportunities, risks, next steps, sources to check), saved to the library, convertible to a proposal. |
| Social & apps | Every platform's real status and what it needs; launcher with search, favourites, recent and your own shortcuts. |
| Connections | Live status of Gmail, Calendar, Drive with test buttons; clear "Not integrated" status and requirements for the rest. |
| Security & control | Approval cards before any account change; activity log of every action; memory off by default; per-area data deletion with confirmation; no secrets in the page (connector tokens stay with Claude). |

## E. Recommended architecture

```
                    ┌──────────────────────── claude.ai (today) ────────────────────────┐
 Voice / text  ──▶  │  Web app: commands → built-in skills ─┐                            │
                    │                                       ├─▶ Claude (tools) ──▶ Gmail │
                    │  approvals · activity · workflows ◀───┘                   Calendar │
                    │  private per-user storage                                 Drive    │
                    └────────────────────────────────────────────────────────────────────┘
                    ┌──────────── your PC ────────────┐      ┌──────── Phase 5b (future) ────────┐
                    │ Desktop app: wake word, live     │      │ Node/TypeScript API + PostgreSQL  │
                    │ prices, open programs & folders  │      │ OAuth token vault (encrypted),    │
                    └──────────────────────────────────┘      │ Meta / WhatsApp / YouTube /       │
                                                              │ LinkedIn / Telegram adapters,     │
                                                              │ webhooks, scheduled jobs          │
                                                              └───────────────────────────────────┘
```

Each integration is a separate adapter (`web/js/connect.js` today) so new platforms are added without touching the rest.

## F. Roadmap

| Phase | Status |
|---|---|
| 1 Audit | Done (this document). |
| 2 Foundation: modular code, dashboard, secure configuration | Done for the web app. |
| 3 Voice intelligence: STT, TTS, intent, context, states | Done. Wake word only in the desktop app. |
| 4 Launcher: web shortcuts, custom shortcuts | Done. Desktop programs and folders: desktop app. |
| 5a Google via Claude connectors | Done: Gmail, Calendar, Drive. |
| 5b Own backend for social platforms | Not started. Needs your developer accounts (see G). |
| 6 Productivity: tasks, reminders, calendar, briefings | Done. Weekly summary and projects view: next. |
| 7 Workflows and approvals | Done, while Jarvis is open. Unattended scheduled runs need 5b's job runner. |
| 8 Testing and production | Browser-tested with stand-in services. Needs your real-account check (see the README). |

Next, in order: weekly business summary; projects grouping for tasks; a desktop bridge so the web app can ask the desktop app to open programs (local WebSocket with a pairing code); then Phase 5b.

## G. External API requirements

| Platform | What it takes | Cost / approval |
|---|---|---|
| Gmail, Calendar, Drive | Already connected through Claude | None |
| Instagram (publishing, insights) | Meta developer app, Instagram Business/Creator account linked to a Facebook Page, server for tokens | Meta app review |
| WhatsApp Business | WhatsApp Business Platform (Cloud API), verified business, dedicated number, approved templates, webhook server | Per-conversation fees; business verification |
| YouTube (upload, analytics) | Google Cloud project, YouTube Data API, OAuth consent screen | Google verification for upload scopes; daily quota |
| LinkedIn (company posts) | LinkedIn developer app, Community Management API | LinkedIn approval |
| Facebook Pages | Meta developer app with Pages permissions | Meta app review |
| Telegram | Bot token from @BotFather, small webhook server | Free |
| Live market data in the web app | A server that fetches quotes (the page cannot) | Free sources or a paid feed |

## H. Security requirements

- Tokens for future platforms live only on the server, encrypted at rest (KMS or libsodium sealed boxes), never in the browser.
- Every write to an outside account goes through an approval card and is logged; the AI cannot send email, post or delete.
- AI output is never executed as code or shell commands. Tools are fixed functions with checked inputs.
- Server endpoints (Phase 5b): HTTPS only, session cookies (HttpOnly, SameSite), CSRF protection, input validation, rate limiting, audit log, per-integration revoke.
- Data deletion controls per area exist today; Phase 5b adds account-wide export and deletion.

## I. Production deployment

- **Web app:** published at https://claude.ai/artifact/GdshmbfnqouLUyMmNnVscd from `web/`. Source of truth is this repository; republish after changes.
- **Desktop app:** `start.bat` on Windows. Package with PyInstaller for a one-file installer when needed.
- **Phase 5b backend:** a container (Node 20 + PostgreSQL 16) on a managed host (Render, Railway, Fly.io or Azure App Service), environment variables for client IDs and secrets, nightly database backups, uptime monitoring and error reporting (Sentry), CI running the test suite on every push.
