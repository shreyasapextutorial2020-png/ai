/**
 * Blocking rules — shared matching logic.
 *
 * The same rules have to be enforced in three places: the browser simulator,
 * the Rust foreground-window watcher and the MV3 extension's declarativeNetRequest
 * rules. Keeping the normalisation and matching here (and mirroring it in
 * `lib.rs`) means "type chess.com, block chess.com" behaves identically
 * everywhere instead of each layer inventing its own comparison.
 */

import type { RuleCategory } from "./types";

/* ------------------------------------------------------------------ */
/* Domains                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turns whatever the user pasted into a bare hostname.
 *
 *   "https://www.Chess.com/play?x=1" -> "chess.com"
 *   "  LICHESS.ORG  "                -> "lichess.org"
 *   "m.youtube.com"                  -> "youtube.com"  (known subdomains fold)
 */
export function normalizeDomain(input: string): string {
  if (!input) return "";
  let value = String(input).trim().toLowerCase();

  // strip a pasted URL down to its host
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^/@]*@/, ""); // credentials
  value = value.split(/[/?#]/)[0];
  value = value.split(":")[0]; // port
  value = value.replace(/\.+$/, "").replace(/^\.+/, ""); // stray dots
  value = value.replace(/^www\./, "");

  // fold the common mobile / regional subdomains onto their parent domain
  value = value.replace(/^(m|mobile|amp|music|www\d?)\./, "");

  // must look like a hostname with at least one dot and a sane TLD
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return "";
  if (!/^[a-z]{2,}$/.test(value.split(".").pop() ?? "")) return "";
  return value;
}

/** True when `host` is the rule's domain or one of its subdomains. */
export function domainMatches(rule: string, host: string): boolean {
  const r = normalizeDomain(rule);
  const h = normalizeDomain(host);
  if (!r || !h) return false;
  return h === r || h.endsWith(`.${r}`);
}

/** A short label for a domain the user typed: "chess.com" -> "Chess.com". */
export function labelForDomain(domain: string): string {
  const clean = normalizeDomain(domain);
  if (!clean) return domain;
  return clean
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(".");
}

/** Guess an icon + category for a hand-typed domain. */
export function guessCategory(domain: string): { icon: string; category: RuleCategory } {
  const d = normalizeDomain(domain);
  const HINTS: Array<[RegExp, string, RuleCategory]> = [
    [/(chess|lichess|chess24|rummy|poker|teenpatti|dream11|mpl|card)/, "♟️", "games"],
    [/(roblox|steam|epicgames|battlenet|ea\.com|rockstar|minecraft|valorant|freefire|bgmi)/, "🎮", "games"],
    [/(youtube|netflix|primevideo|hotstar|zee5|sonyliv|jiocinema|twitch|dailymotion|vimeo)/, "🎬", "video"],
    [/(instagram|tiktok|snapchat|facebook|twitter|x\.com|reddit|threads|pinterest|tumblr|quora|linkedin)/, "📱", "social"],
    [/(whatsapp|telegram|discord|messenger|signal|slack)/, "💬", "chat"],
    [/(porn|xxx|adult|sex)/, "🔞", "adult"],
    [/(amazon|flipkart|myntra|ajio|meesho|ebay|aliexpress|croma|nykaa)/, "🛒", "shopping"],
    [/(news|timesofindia|hindustantimes|ndtv|bbc|cnn|thehindu|inshorts)/, "📰", "news"],
    [/(khanacademy|coursera|udemy|nptel|byjus|vedantu|physicswallah|wikipedia|docs\.google|notion|arxiv)/, "📚", "study"],
  ];
  for (const [re, icon, category] of HINTS) {
    if (re.test(d)) return { icon, category };
  }
  return { icon: "🌐", category: "other" };
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

/** "C:\\Program Files\\Chess.com\\Chess.exe" -> "chess" */
export function normalizeProcess(input: string): string {
  if (!input) return "";
  let value = String(input).trim().toLowerCase().replace(/\\/g, "/");
  value = value.split("/").pop() ?? value;
  value = value.replace(/\.exe$/, "");
  return value.replace(/[^a-z0-9._+-]/g, "");
}

/**
 * Matches a user rule against the foreground window.
 *
 * Real Windows process names rarely equal what a user types, so a rule matches
 * when any of these hold:
 *   - the process names are equal            "chess" == "chess"
 *   - the rule is a fragment of the process  "chess" ⊂ "chess.com", "chess-ai"
 *   - the rule appears in the window title   "chess.com" ⊂ "Chess.com — Play Chess"
 *
 * Titles are only consulted for rules of 4+ characters, which keeps short rules
 * like "x" or "tv" from nuking unrelated windows.
 */
export function matchesProcessRule(entry: string, processName: string, windowTitle = ""): boolean {
  const rule = normalizeProcess(entry);
  const proc = normalizeProcess(processName);
  if (!rule || !proc) return false;

  if (rule === proc) return true;
  if (rule.length >= 3 && proc.includes(rule)) return true;
  if (rule.length >= 4 && normalizeProcess(proc) === normalizeProcess(rule.split(".")[0])) return true;

  if (rule.length >= 4 && windowTitle) {
    const title = windowTitle.toLowerCase();
    const plain = rule.replace(/[._-]/g, " ");
    if (title.includes(rule) || title.includes(plain)) return true;
    // titles often drop the TLD ("Chess.com — Play" is caught above, but
    // "Chess · Play" needs the bare stem)
    const stem = rule.split(".")[0];
    if (stem.length >= 5 && new RegExp(`\\b${stem}\\b`).test(title)) return true;
  }
  return false;
}

/** Which of the user's entries (if any) blocks this window. */
export function findMatchingRule(
  entries: string[],
  processName: string,
  windowTitle = "",
): string | null {
  for (const entry of entries) {
    if (matchesProcessRule(entry, processName, windowTitle)) return entry;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Desktop apps worth offering when a site is blocked — a site rule alone cannot
 * stop a native app, which is a common source of "I blocked it but it still
 * works" reports.
 */
const SITE_APP_HINTS: Array<[string, string[]]> = [
  ["chess.com", ["Chess.exe", "chess.com.exe"]],
  ["lichess.org", ["lichess.exe", "Lichess.exe"]],
  ["chess24.com", ["Chess24.exe"]],
  ["youtube.com", ["YouTube.exe", "youtube-music-desktop.exe"]],
  ["instagram.com", ["instagram.exe"]],
  ["tiktok.com", ["tiktok.exe"]],
  ["snapchat.com", ["snapchat.exe"]],
  ["facebook.com", ["facebook.exe"]],
  ["discord.com", ["discord.exe"]],
  ["reddit.com", ["reddit.exe"]],
  ["x.com", ["twitter.exe"]],
  ["twitter.com", ["twitter.exe"]],
  ["spotify.com", ["Spotify.exe"]],
  ["netflix.com", ["netflix.exe"]],
  ["twitch.tv", ["Twitch.exe"]],
  ["whatsapp.com", ["whatsapp.exe"]],
  ["telegram.org", ["telegram.exe", "TelegramDesktop.exe"]],
  ["steampowered.com", ["steam.exe", "steamwebhelper.exe"]],
  ["roblox.com", ["RobloxPlayerBeta.exe"]],
];

/** Apps worth suggesting for a blocked domain (may be empty). */
export function suggestedAppsForDomain(domain: string): string[] {
  const d = normalizeDomain(domain);
  for (const [site, apps] of SITE_APP_HINTS) {
    if (d === site || d.endsWith(`.${site}`)) return apps;
  }
  // any "foo.com" style rule: offer "foo.exe" as a long shot so the user
  // can accept or ignore it
  const stem = d.split(".")[0];
  if (stem && stem.length >= 3 && stem !== "www") return [`${stem}.exe`];
  return [];
}

/** Splits rules into "active during focus" and "always active" lists. */
export function splitByMode<T extends { enabled: boolean; mode: "focus" | "always" }>(
  rules: T[],
): { focus: T[]; always: T[] } {
  const enabled = rules.filter((r) => r.enabled);
  return {
    focus: enabled.filter((r) => r.mode !== "always"),
    always: enabled.filter((r) => r.mode === "always"),
  };
}
