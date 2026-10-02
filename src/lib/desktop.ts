/**
 * Desktop bridge.
 *
 * In the packaged Regain PC app this module talks to the Rust/Tauri core
 * (foreground-window monitor, native blocking, extension WebSocket).
 * In a plain browser (dev preview) it falls back to a deterministic simulator
 * so every screen of the product stays fully explorable.
 */

import { domainMatches, findMatchingRule } from "./blocking";

export interface WindowInfo {
  process_name: string;
  window_title: string;
  pid: number;
  /** present when a browser companion reports the active tab's domain */
  domain?: string;
}

export type BridgeMode = "tauri" | "browser";

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_IPC__);
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn | null> {
  if (!isTauri()) return null;
  if (cachedInvoke) return cachedInvoke;
  try {
    const mod = await import(/* @vite-ignore */ "@tauri-apps/api/core");
    cachedInvoke = mod.invoke as InvokeFn;
    return cachedInvoke;
  } catch {
    return null;
  }
}

/** Never throws — the UI must stay usable when a native call is missing. */
export async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return (await invoke<T>(cmd, args)) ?? null;
  } catch (err) {
    console.warn(`[regain] native command "${cmd}" failed`, err);
    return null;
  }
}

export async function listenSafe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const mod = await import(/* @vite-ignore */ "@tauri-apps/api/event");
    const unlisten = await mod.listen<T>(event, (e) => handler(e.payload));
    return () => unlisten();
  } catch {
    return () => {};
  }
}

/* ------------------------------------------------------------------ */
/* Focus Guard overlay window (blocker)                                */
/* ------------------------------------------------------------------ */

export async function showBlockerWindow(payload: { app: string; title: string }) {
  await invokeSafe("show_blocker_window", payload);
  if (!isTauri()) {
    window.dispatchEvent(new CustomEvent("regain:blocker", { detail: payload }));
  }
}

export async function hideBlockerWindow() {
  await invokeSafe("hide_blocker_window");
}

/* ------------------------------------------------------------------ */
/* Native notification                                                 */
/* ------------------------------------------------------------------ */

export async function notify(title: string, body: string) {
  if (isTauri()) {
    await invokeSafe("notify", { title, body });
    return;
  }
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* notifications are best-effort */
  }
}

export async function requestNotificationPermission() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Foreground window monitoring                                        */
/* ------------------------------------------------------------------ */

const SIM_APPS: Array<{ process_name: string; window_title: string; domain?: string }> = [
  { process_name: "chrome.exe", window_title: "Physics — Lecture 4 — YouTube", domain: "youtube.com" },
  { process_name: "chrome.exe", window_title: "Revision notes — Google Docs", domain: "docs.google.com" },
  { process_name: "chrome.exe", window_title: "Chess.com — Play Chess Online", domain: "chess.com" },
  { process_name: "Code.exe", window_title: "main.rs — regain-core" },
  { process_name: "discord.exe", window_title: "#general — Discord" },
  { process_name: "chrome.exe", window_title: "Instagram • Reels", domain: "instagram.com" },
  { process_name: "Chess.exe", window_title: "Chess.com — Play Chess" },
  { process_name: "chrome.exe", window_title: "Friv — Free Online Games", domain: "friv.com" },
  { process_name: "tiktok.exe", window_title: "TikTok — For You" },
  { process_name: "chrome.exe", window_title: "Khan Academy — Limits", domain: "khanacademy.org" },
  { process_name: "lichess.exe", window_title: "Lichess — Play" },
  { process_name: "steam.exe", window_title: "Steam — Library" },
  { process_name: "chrome.exe", window_title: "Reddit — r/GetStudying", domain: "reddit.com" },
  { process_name: "WINWORD.EXE", window_title: "Chemistry notes.docx" },
];

export interface MonitorOptions {
  /** process rules that only bite during a focus session */
  blockedProcesses: string[];
  /** process rules that bite even outside a session ("Always") */
  alwaysProcesses: string[];
  blockedDomains: string[];
  /** domain rules that bite even outside a session ("Always") */
  alwaysDomains: string[];
  active: boolean;
  onWindow: (info: WindowInfo) => void;
  onBlocked: (info: WindowInfo) => void;
}

/**
 * Watches the foreground window. Returns an unsubscribe function.
 * Native path streams Tauri events; browser path ticks a simulator.
 */
export function startMonitor(opts: MonitorOptions): () => void {
  let stopped = false;
  let cleanup: (() => void)[] = [];

  (async () => {
    if (isTauri()) {
      const un1 = await listenSafe<WindowInfo>("window-focus-changed", (p) => {
        if (!stopped) opts.onWindow(p);
      });
      const un2 = await listenSafe<WindowInfo>("distraction-blocked", (p) => {
        if (!stopped) opts.onBlocked(p);
      });
      cleanup = [un1, un2];
    } else {
      // Browser simulator: rotates realistic foreground windows and escalates
      // to an actual block when one of the user's rules matches — including
      // "Always" rules while focus is off, so the whole pipeline is demoable
      // and testable without Windows.
      let tick = 0;
      const isBlockedNow = (info: { process_name: string; window_title: string; domain?: string }) =>
        Boolean(info.domain)
          ? [...opts.blockedDomains, ...opts.alwaysDomains].some((d) => domainMatches(d, info.domain || ""))
          : findMatchingRule(
              [...opts.blockedProcesses, ...opts.alwaysProcesses],
              info.process_name,
              info.window_title,
            ) !== null;

      const timer = window.setInterval(() => {
        if (stopped) return;
        tick += 1;
        // Demo/dev hook: assign window.__REGAIN_SIM_WINDOW__ to force which app
        // the simulated monitor reports (used by the demo tour and the tests).
        const forced = (window as unknown as Record<string, unknown>).__REGAIN_SIM_WINDOW__ as
          | { process_name: string; window_title: string; domain?: string }
          | undefined;
        const info = forced ?? SIM_APPS[tick % SIM_APPS.length];
        opts.onWindow({ ...info, pid: 1000 + (tick % 400) });

        const alwaysBlocked = Boolean(info.domain)
          ? opts.alwaysDomains.some((d) => domainMatches(d, info.domain || ""))
          : findMatchingRule(opts.alwaysProcesses, info.process_name, info.window_title) !== null;

        // Always rules fire regardless of the session; focus rules need one.
        const blockedNow =
          alwaysBlocked || (opts.active && isBlockedNow(info));

        if (blockedNow) {
          opts.onBlocked({ ...info, pid: 9000 + tick });
          return;
        }

        // Otherwise, once in a while, prove that an armed rule really does
        // intercept by escalating a *matching* catalogue entry.
        if (opts.active && tick % 5 === 0) {
          const target = SIM_APPS.find((candidate) =>
            candidate.domain
              ? opts.blockedDomains.some((d) => domainMatches(d, candidate.domain || ""))
              : findMatchingRule(opts.blockedProcesses, candidate.process_name, candidate.window_title) !== null,
          );
          if (target) {
            opts.onWindow({ ...target, pid: 9000 + tick });
            opts.onBlocked({ ...target, pid: 9000 + tick });
          }
        }
      }, 4000);
      cleanup = [() => window.clearInterval(timer)];
    }
  })();

  return () => {
    stopped = true;
    cleanup.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    cleanup = [];
  };
}

export interface RulePayload {
  pattern: string;
  always: boolean;
}

export async function syncBlocklistToNative(rules: RulePayload[]) {
  await invokeSafe("update_blocklist", { rules });
}

export async function syncWebBlocklistToNative(rules: RulePayload[]) {
  await invokeSafe("update_web_blocklist", { rules });
}

export interface BridgeStatus {
  clients: number;
  port: number;
}

/** How many extensions are connected to the desktop bridge (0 in a browser). */
export async function getBridgeStatus(): Promise<BridgeStatus | null> {
  return invokeSafe<BridgeStatus>("get_bridge_status");
}

export async function syncExtensionSettings(payload: {
  reelsBlocked: boolean;
  studyMode: boolean;
  channels: string[];
  /** block every site except `allowlist` while a session runs */
  blockAll?: boolean;
  allowlist?: string[];
}) {
  await invokeSafe("update_extension_settings", payload);
}

export async function syncTimerToNative(payload: {
  mode: string;
  remainingSec: number;
  plannedSec: number;
  label: string;
}) {
  await invokeSafe("sync_timer", payload);
}

export async function setFocusActiveNative(active: boolean, strict: boolean) {
  await invokeSafe("toggle_focus_mode", { active });
  await invokeSafe("set_strict_mode", { enabled: strict });
}

export async function minimizeActiveWindow() {
  await invokeSafe("minimize_active_window");
}
