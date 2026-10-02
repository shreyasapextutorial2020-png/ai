# Regain — Focus & Digital Wellbeing (PC)

A full **Regain for PC**: strict app blocking, Pomodoro timers, multiplayer study
rooms, screen‑time tracking, and Reels/Shorts blocking that still lets educational
content through. Built as a Tauri 2 desktop app (Rust core + React UI) with a
browser‑preview mode so the whole product runs without a desktop build.

![icon](icons/128x128.png)

---

## What's inside

| Area | What you get |
| --- | --- |
| **Focus Timer** | Study (open‑ended), Stopwatch with laps, Countdown with presets 5–180 min, subject tagging, per‑session 👍/👎 |
| **Pomodoro** | Adjustable focus/short/long lengths, rounds before a long break, auto‑start breaks and focus, live phase ring |
| **App Blocker** | 20+ preloaded Windows processes (Instagram, TikTok, Snapchat, X, Reddit, Discord, Steam, Free Fire…), custom additions, "in focus" vs "always" per rule |
| **Website Blocker** | 20+ domains incl. adult sites, subdomain matching, bulk "block all" by category, custom domains |
| **Block Reels & Shorts** | Hides Instagram Reels, YouTube Shorts, Snapchat Spotlight and Facebook Reels; `/shorts/` URLs are intercepted and media paused |
| **YouTube Study Mode** | Channel allow‑list; home feed, recommendations, comments and trending are removed while you focus |
| **Screen Time Tracker** | Per‑app and per‑site usage, category donut, 14‑day focus chart, blocked‑attempt log, session history with ratings |
| **Multiplayer Rooms** | Real WebSocket study rooms with shared leaderboard, chat, reactions and a zero‑dependency relay server |
| **Focus Planner** | Weekly grid, drag‑free block editor, completion ticks, "start this block" one‑click |
| **Focus Music** | 10 soundscapes synthesised live with the Web Audio API (rain, brown/pink/white noise, ocean, fire, forest, café, lo‑fi pads, 40 Hz deep focus) — no audio files shipped |
| **Themes** | 7 themes incl. AMOLED and Daylight, 8 accents, 5 wallpapers |
| **Strict Mode** | Levels 1–3 (confirm → hold‑to‑quit → cannot stop), anti‑uninstall guard, strict record tracking |
| **Accessibility** | Visible keyboard focus rings, `role="switch"` toggles with accessible names, `prefers-reduced-motion` support, higher‑contrast light theme |
| **Focus Guard reminders** | Pro nudge when you drift onto an *unblocked* distracting app or site mid‑session (blocked apps are intercepted as usual, so Study Mode browsers and notes are untouched) |
| **Planner reminders** | A scheduled focus block raises a notification the moment it starts |
| **Keyboard shortcuts** | `Space` quick session / pause / resume, `M` soundscape, `Esc` dismiss the Focus Guard, `?` shortcut list |
| **Progress** | Streaks, 10‑week consistency heatmap, subject balance, trend vs previous week, rating‑driven session suggestions |
| **Pro** | Free vs Pro feature matrix, plan picker, demo activation. Reels/Shorts shield and YouTube Study Mode are Pro‑gated in the UI (with a one‑click upgrade path); the app/website blockers, adult‑site blocking, timers, screen time, planner and rooms stay free |

---

## Quick start

### 1. Browser preview (no desktop build needed)

```bash
npm install
npm run relay     # terminal 1 — multiplayer relay on :8790 (optional)
npm run dev       # terminal 2 — Vite dev server on 0.0.0.0:1420
```

Open `http://localhost:1420`. Everything works here: the foreground‑window
monitor is *simulated* (rotating fake windows + interception events), audio is
real, rooms connect to the real relay.

### 2. Desktop app (Tauri 2)

Requires Rust + the platform webview prerequisites
(<https://tauri.app/start/prerequisites/>).

```bash
npm install
npm run tauri dev      # hot‑reloading desktop app
npm run tauri build    # installers in src-tauri/target/release/bundle
```

The Rust crate lives at the repo root (`lib.rs`, `monitor.rs`, `Cargo.toml`,
`build.rs`) with config in `tauri.conf.json` and permissions in
`capabilities/default.json`.

**Privacy:** the core reads only the foreground **process name** and **window
title** (`GetForegroundWindow` / `osascript` / `xdotool`) and never screen
content. Website attribution comes from the extension reporting the active tab
domain.

### 3. Companion extension (Chrome / Edge, MV3)

1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `regain-extension/` folder.
3. Start a focus session in Regain. The badge turns **ON** and blocking arms
   automatically; when the app is closed the last known state is kept.

### 4. Tests

```bash
npm test                # all six suites
npm run test:engine     # pure logic (analytics, streaks, ratings, rooms)
npm run test:relay      # raw RFC 6455 protocol test of the relay
npm run test:extension  # manifest / permission / CSP validation
npm run test:icons      # icon format + Tauri config validation
npm run icons           # regenerate icons/icon.icns from the PNG set
```

`npm test` bundles the app with esbuild, starts a relay if one is not running,
then runs **222 checks** across seven suites:

| Suite | Covers |
| --- | --- |
| `engine` (50) | formatting, analytics, streaks, 👍/👎 recommendations, drift helpers, v1→v2 state migration, pruning |
| `icons` (32) | every bundled icon exists, is 8‑bit RGBA (Tauri rejects RGB at compile time), the ICO/ICNS containers parse, and the Tauri window/capability config is consistent |
| `extension` (34) | manifest ↔ shipped files, `chrome.*` usage ↔ declared permissions, host permissions ↔ content-script matches, MV3 CSP compliance (no inline scripts, no `javascript:` URLs, no `eval`) |
| `relay` (11) | raw RFC 6455 handshake, presence, progress fan‑out, chat, reactions, leave |
| `ui-render` (30) | every one of the 12 routes renders with zero console errors, every control has an accessible name, Free/Pro gating works end to end |
| `ui-resilience` (8) | **no relay running** → the app degrades to local mode instead of crashing |
| `ui-flow` (35) | session completion → logging → streak, blocking toggles, audio, planner + drift reminders, keyboard shortcuts, and two clients (the jsdom app and a raw WebSocket client) sharing one room through the real relay |

---

## Architecture

```
┌──────────────────────────── React UI (src/) ────────────────────────────┐
│ pages/    12 feature screens            store/AppStore.tsx  single source│
│ components/ Shell, FocusGuard, UI kit   lib/  timer, blocker, audio,     │
│ styles/    design system tokens         rooms, analytics, recommendations│
└───────────────┬──────────────────────────────────────┬──────────────────┘
                │ invoke / events                      │ WebSocket
      ┌─────────▼──────────┐              ┌────────────▼───────────────────┐
      │ Rust core (Tauri)  │              │ room relay (server/*.mjs)      │
      │ • focus state      │              │ • rooms, presence, chat        │
      │ • window monitor   │              │ • focused minutes only         │
      │ • blocker + overlay│              └────────────────────────────────┘
      └─────────┬──────────┘
                │ ws://127.0.0.1:48123
      ┌─────────▼───────────────────────────────────────────────────────┐
      │ Browser extension (regain-extension/)                           │
      │ • declarativeNetRequest domain redirects → blocked.html         │
      │ • CSS shields for Reels/Shorts, Study Mode channel allow‑list   │
      │ • reports the active tab domain back to the core                │
      └─────────────────────────────────────────────────────────────────┘
```

### Timer engine

`store/AppStore.tsx` owns a 1 Hz tick that (a) accrues screen‑time for the live
window, (b) advances rooms, and (c) completes sessions when the planned time is
reached. Pomodoro rounds are logged individually and phase‑advance through
short/long breaks. State is persisted to `localStorage` under
`regain.pc.state.v1` (debounced, trimmed to 400 sessions / 60 days of usage).

### State, migration and reminders

Saved state lives in `localStorage` under `regain.pc.state.v1` and is versioned.
`src/lib/persist.ts` migrates older blobs instead of discarding them — v1 → v2
keeps every session, usage row and setting while filling in newly added switches.
Pruning caps history at 400 sessions / 60 days of usage / 200 blocked attempts /
20 reminders.

Reminders are raised by the 1 Hz tick in `AppStore`:

* **drift** — the foreground window (or browser domain) is an *unblocked* social,
  video, games, news or shopping app for `focusGuardMinutes` while a session runs;
  fires once per continuous drift and resets when you switch back.
* **planner** — a scheduled block with reminders enabled is starting now.

They surface as toasts in the shell and as native notifications. Both are pure
helpers (`isDistractingCategory`, `driftThresholdSec`, `driftNudgeText`) and are
unit-tested.

### Bridge protocol (`:48123`)

| Direction | Frame |
| --- | --- |
| app → extension | `{type:"FOCUS_MODE_STATE", active, strict, domains, reelsBlocked, studyMode, channels}` |
| app → extension | `{type:"TIMER", mode, remainingSec, plannedSec, label}` |
| extension → app | `{type:"ACTIVE_DOMAIN", domain, url, title}` |

### Room relay protocol (`:8790`)

Client sends `hello` / `progress` / `chat` / `reaction` / `bye`; the server
broadcasts `{t:"state", members, chat}`. Health check: `GET /health`.
Override with `PORT` / `HOST`. Members expire after 45 s of silence and empty
rooms are reaped.

---

## Configuration highlights

| Setting | Where | Default |
| --- | --- | --- |
| Daily focus goal | Settings → Profile | 120 min |
| Strict level | Strict Mode | 2 (hold to quit) |
| Focus Guard overlay | Settings → Focus behaviour | off |
| Block during focus | Settings → Focus behaviour | on |
| Soundscape + volume | Focus Music | Rainfall, 35% |
| Room relay URL | Settings → System | auto (`:8790` on this host) |
| Focus Guard reminders | Settings → Focus behaviour | on (Pro), nudge after 15 min |
| Simulated foreground (dev) | `window.__REGAIN_SIM_WINDOW__` | rotates every 4 s |

---

## Continuous integration

`.github/workflows/ci.yml` runs four jobs:

| Job | Runner | Verifies |
| --- | --- | --- |
| **web** | ubuntu | typecheck, all seven test suites, production build, uploads `dist` |
| **rust** | windows / ubuntu / macos | `cargo check`, `cargo test`, plus advisory `fmt` + `clippy` |
| **extension** | ubuntu | manifest/permission/CSP validation, syntax check, packaged `regain-extension.zip` |
| **desktop** | windows | full `tauri build` → uploads the `.msi` / `.exe` installers |

The Rust and Windows jobs exist because this project was assembled in an
environment without a Rust toolchain: CI is what actually compiles the core and
produces installers. Style gates (`cargo fmt`, `cargo clippy`) run advisory so a
formatting nit cannot hide a real regression.

When a Rust job fails it publishes its first compiler error as a commit status
and the log tail as a commit comment, so a failure is diagnosable from the API
or the PR timeline without downloading the Actions log archive. That channel is
how the RGBA icon bug (`icons/32x32.png is not RGBA`, which only broke Linux and
macOS builds) was found and fixed.

## Verification status

Verified in this workspace:

* `npm run build` — TypeScript clean, 55 modules, 289 kB JS (88 kB gzip).
* `npm test` — engine 50, extension 34, icons 32, relay 11, ui‑render 30, ui‑resilience 8, ui‑flow 35 checks pass.
* Relay verified end‑to‑end with two independent clients (presence, progress,
  chat, reactions, leave).
* Live Vite preview serves every route; the dev server binds `0.0.0.0` and
  allows tunnel hosts.
* Resilience: with no relay listening the room transport detaches its handlers
  and falls back to local mode (regression-tested — this used to recurse until
  the stack blew up).

Not verified here (no Rust toolchain and no Windows in this environment):

* Local `cargo build` — no Rust toolchain in this environment. CI covers it:
  Windows `cargo check`/`cargo test` pass and the desktop job produces
  `.msi`/`.exe` installers via `tauri build`. The Linux and macOS jobs drive
  `tauri::generate_context!` harder and exposed an RGB icon bug; the icons are
  now RGBA and the `icons` suite guards it, awaiting the next CI run.
* Native foreground‑window detection and minimise‑on‑sight blocking.
* The unpacked Chrome extension inside a real browser (its manifest, permissions
  and MV3 compliance are validated statically in CI instead).

---

## Project layout

```
lib.rs, monitor.rs, Cargo.toml, build.rs   Rust core (focus engine, window monitor, bridge)
tauri.conf.json, capabilities/             Tauri config + permissions
icons/                                     app icons (generated)
index.html, vite.config.ts, tsconfig.json  frontend build
src/
  App.tsx, main.tsx                        shell, routing, blocker window
  components/                              Shell, FocusGuard, UI kit
  pages/                                   12 feature screens
  store/AppStore.tsx                       state, timer engine, blocker, rooms
  lib/                                     types, defaults, utils, audio, rooms,
                                           desktop bridge, demo data, recommendations
  styles/global.css                        design system
regain-extension/                          Chrome/Edge MV3 companion
server/room-server.mjs                     zero-dependency WebSocket relay
tests/                                     engine, extension, icons, relay,
                                           ui-render, ui-resilience, ui-flow
scripts/make-icns.mjs                      macOS .icns container builder
.github/workflows/ci.yml                   web / rust / extension / desktop jobs
```

## License

Provided as-is for the Regain project.
