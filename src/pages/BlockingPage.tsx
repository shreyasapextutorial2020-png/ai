import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Empty, Modal, Segmented, Toggle } from "../components/ui";
import { CATEGORY_LABELS } from "../lib/defaults";
import { getBridgeStatus, isTauri } from "../lib/desktop";
import { navigateTo } from "../lib/nav";
import { normalizeDomain, suggestedAppsForDomain } from "../lib/blocking";
import type { RuleCategory, RuleMode } from "../lib/types";

type Tab = "apps" | "websites" | "reels" | "study";

/** One-tap bundles: the distractions students actually ask to block. */
const PRESETS: Array<{ id: string; label: string; icon: string; categories: RuleCategory[]; extraDomains?: string[] }> = [
  { id: "chess", label: "Chess & board games", icon: "♟️", categories: ["games"] },
  { id: "video", label: "Streaming & short video", icon: "🎬", categories: ["video"] },
  { id: "social", label: "Social media", icon: "📱", categories: ["social"] },
  { id: "chat", label: "Chat apps & sites", icon: "💬", categories: ["chat"] },
  { id: "shopping", label: "Shopping", icon: "🛒", categories: ["shopping"] },
  { id: "adult", label: "Adult sites (always blocked)", icon: "🔞", categories: ["adult"] },
];

/** Per-rule hit counter, so a rule that never fires is obvious at a glance. */
function useHitCounts() {
  const { state } = useStore();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of state.blockedLog) {
      const key = String(entry.key ?? "").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [state.blockedLog]);
}

/** Pro lock used by the Reels/Shorts shield and YouTube Study Mode. */
function ProLock({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="row"
      style={{
        gap: 12,
        padding: 14,
        marginBottom: 14,
        borderRadius: 14,
        border: "1px solid rgba(245,158,11,.4)",
        background: "rgba(245,158,11,.1)",
      }}
    >
      <span style={{ fontSize: 22 }}>🔒</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title} is a Pro feature</div>
        <div className="small muted">{body}</div>
      </div>
      <button className="btn sm primary" onClick={() => navigateTo("pro")}>
        ✨ Unlock Pro
      </button>
    </div>
  );
}

const REELS_TARGETS = [
  { id: "instagram", label: "Instagram Reels", icon: "📸", host: "instagram.com" },
  { id: "youtube", label: "YouTube Shorts", icon: "▶️", host: "youtube.com" },
  { id: "snapchat", label: "Snapchat Spotlight", icon: "👻", host: "snapchat.com" },
  { id: "facebook", label: "Facebook Reels", icon: "📘", host: "facebook.com" },
];

export function BlockingPage() {
  const { state, actions, isFocusActive, currentWindow } = useStore();
  const [tab, setTab] = useState<Tab>("apps");
  const [showAdd, setShowAdd] = useState(false);
  const [newApp, setNewApp] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [query, setQuery] = useState("");
  const [siteQuery, setSiteQuery] = useState("");
  const [bridgeClients, setBridgeClients] = useState<number | null>(null);
  const [justTested, setJustTested] = useState<string>("");
  const [addError, setAddError] = useState<string>("");
  const [addedNote, setAddedNote] = useState<string>("");
  const hits = useHitCounts();
  const isPro = state.settings.pro;

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const poll = async () => {
      const status = await getBridgeStatus();
      if (alive && status) setBridgeClients(status.clients);
    };
    void poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const apps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.appRules
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.process.includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [state.appRules, query]);

  const sites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    return state.webRules
      .filter((r) => !q || r.label.toLowerCase().includes(q) || r.domain.includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label));
  }, [state.webRules, siteQuery]);

  const enabledApps = state.appRules.filter((r) => r.enabled).length;
  const enabledSites = state.webRules.filter((r) => r.enabled).length;
  const blockedToday = state.blockedLog.filter(
    (b) => new Date(b.at).toDateString() === new Date().toDateString(),
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card className="tight">
        <div className="row wrap" style={{ gap: 12 }}>
          <Chip tone={isFocusActive ? "good" : ""}>
            {isFocusActive ? "● Blocking armed" : "◌ Blocking idle until you start focusing"}
          </Chip>
          <Chip tone="accent">{enabledApps} apps</Chip>
          <Chip tone="accent">{enabledSites} websites</Chip>
          <Chip tone={state.settings.blockReelsShorts ? "good" : "warn"}>
            {state.settings.blockReelsShorts ? "Reels & Shorts blocked" : "Reels & Shorts allowed"}
          </Chip>
          {isTauri() && (
            <Chip tone={bridgeClients ? "good" : "warn"}>
              {bridgeClients
                ? `Extension connected (${bridgeClients})`
                : "Extension not detected — site blocking needs it"}
            </Chip>
          )}
          <div className="spacer" />
          <span className="small muted">
            {blockedToday.length} blocked today · watching: {currentWindow?.process_name ?? "—"}
            {currentWindow?.window_title ? ` · ${currentWindow.window_title.slice(0, 42)}` : ""}
          </span>
        </div>
      </Card>

      <Card
        head="Quick presets"
        hint="One tap arms a whole category — chess.com, lichess, casual game sites, streaming and more"
      >
        <div className="row wrap" style={{ gap: 8 }}>
          {PRESETS.map((preset) => {
            const targets = state.webRules.filter((r) => preset.categories.includes(r.category));
            const appsToo = state.appRules.filter((r) => preset.categories.includes(r.category));
            const allOn =
              targets.length > 0 &&
              targets.every((r) => r.enabled) &&
              (appsToo.length === 0 || appsToo.every((r) => r.enabled));
            return (
              <button
                key={preset.id}
                className={`btn sm ${allOn ? "primary" : ""}`}
                title={
                  allOn
                    ? `Unblock all ${preset.label.toLowerCase()}`
                    : `Block ${targets.length} site(s) and ${appsToo.length} app(s): ${preset.label}`
                }
                onClick={() => {
                  const enable = !allOn;
                  preset.categories.forEach((category) =>
                    actions.setCategoryEnabled(category, enable, category === "adult" ? "always" : undefined),
                  );
                  actions.updateSettings({
                    appBlocker: enable ? true : state.settings.appBlocker,
                    websiteBlocker: enable ? true : state.settings.websiteBlocker,
                  });
                }}
              >
                {preset.icon} {preset.label}
                <span className="tiny muted"> · {targets.length + appsToo.length}</span>
              </button>
            );
          })}
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Rules marked <strong>Always</strong> bite outside focus sessions too — use them for the sites you never
          want to open. Everything else is enforced only while a session runs.
        </p>
      </Card>

      <div className="tabs">
        <button className={`tab ${tab === "apps" ? "active" : ""}`} onClick={() => setTab("apps")}>
          🖥️ App blocker
        </button>
        <button className={`tab ${tab === "websites" ? "active" : ""}`} onClick={() => setTab("websites")}>
          🌐 Website blocker
        </button>
        <button className={`tab ${tab === "reels" ? "active" : ""}`} onClick={() => setTab("reels")}>
          📱 Reels & Shorts
        </button>
        <button className={`tab ${tab === "study" ? "active" : ""}`} onClick={() => setTab("study")}>
          🎓 YouTube Study Mode
        </button>
      </div>

      {tab === "apps" && (
        <Card
          head="App blocker"
          hint="Regain watches the foreground window and closes or minimises distractions instantly"
          actions={
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ width: 180 }}
                placeholder="Search apps…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn sm primary" onClick={() => setShowAdd(true)}>
                + Add app
              </button>
            </div>
          }
        >
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <Toggle
              on={state.settings.appBlocker}
              label="App blocking master switch"
              onChange={(v) => actions.updateSettings({ appBlocker: v })}
            />
            <span className="small">Master switch — app blocking during focus sessions</span>
          </div>
          <div className="list">
            {apps.map((rule) => (
              <div className="list-row" key={rule.id}>
                <div className="icon">{rule.icon}</div>
                <div className="meta">
                  <div className="title">{rule.name}</div>
                  <div className="sub mono">{rule.process}</div>
                </div>
                <Chip className="tiny">{CATEGORY_LABELS[rule.category]}</Chip>
                <Chip tone={(hits.get(rule.process.toLowerCase()) ?? 0) > 0 ? "good" : ""} className="tiny">
                  {hits.get(rule.process.toLowerCase()) ?? 0} blocked
                </Chip>
                <button
                  className="btn sm ghost"
                  title={`Test that ${rule.name} is caught — logs a block now`}
                  aria-label={`Test blocking ${rule.name}`}
                  onClick={() => {
                    actions.testBlock("app", rule.process);
                    setJustTested(rule.process);
                    window.setTimeout(() => setJustTested(""), 2500);
                  }}
                >
                  {justTested === rule.process ? "✓ caught" : "Test"}
                </button>
                <Segmented<RuleMode>
                  value={rule.mode}
                  onChange={(mode) => actions.setRuleMode(rule.id, "app", mode)}
                  options={[
                    { value: "focus", label: "In focus" },
                    { value: "always", label: "Always" },
                  ]}
                />
                {rule.custom && (
                  <button className="btn sm ghost" onClick={() => actions.removeCustomRule(rule.id)} aria-label="Remove custom rule" title="Remove custom rule">
                    🗑️
                  </button>
                )}
                <Toggle on={rule.enabled} label={`Block ${rule.name}`} onChange={() => actions.toggleAppRule(rule.id)} />
              </div>
            ))}
          </div>
          {!isTauri() && (
            <p className="tiny muted" style={{ marginTop: 14 }}>
              Browser preview: process names are simulated. In the Windows build these are matched
              against the real foreground process and the window is minimised on sight.
            </p>
          )}
        </Card>
      )}

      {tab === "websites" && (
        <Card
          head="Website blocker"
          hint="Enforced by the companion extension. Subdomains are covered: play.chess.com is caught by chess.com"
          actions={
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ width: 180 }}
                placeholder="Search sites…"
                value={siteQuery}
                onChange={(e) => setSiteQuery(e.target.value)}
              />
              <button className="btn sm primary" onClick={() => setShowAdd(true)}>
                + Add website
              </button>
            </div>
          }
        >
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <Toggle
              on={state.settings.websiteBlocker}
              label="Website blocking master switch"
              onChange={(v) => actions.updateSettings({ websiteBlocker: v })}
            />
            <span className="small">Master switch — website blocking during focus sessions</span>
          </div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            {["adult", "social", "video"].map((cat) => {
              const targets = state.webRules.filter((r) => r.category === cat);
              const allOn = targets.every((r) => r.enabled);
              return (
                <button
                  key={cat}
                  className={`btn sm ${allOn ? "primary" : ""}`}
                  onClick={() => {
                    const should = !allOn;
                    targets.forEach((r) => {
                      if (r.enabled !== should) actions.toggleWebRule(r.id);
                    });
                  }}
                >
                  {should_label(cat)}: {allOn ? "block all" : "unblock all"}
                </button>
              );
            })}
          </div>
          <div className="list">
            {sites.map((rule) => (
              <div className="list-row" key={rule.id}>
                <div className="icon">{rule.icon}</div>
                <div className="meta">
                  <div className="title">{rule.label}</div>
                  <div className="sub mono">{rule.domain}</div>
                </div>
                {rule.category === "adult" && <Chip tone="bad">always on</Chip>}
                <Chip tone={(hits.get(rule.domain) ?? 0) > 0 ? "good" : ""} className="tiny">
                  {hits.get(rule.domain) ?? 0} blocked
                </Chip>
                <button
                  className="btn sm ghost"
                  title={`Test that ${rule.domain} is caught — logs a block now`}
                  aria-label={`Test blocking ${rule.label}`}
                  onClick={() => {
                    actions.testBlock("web", rule.domain);
                    setJustTested(rule.domain);
                    window.setTimeout(() => setJustTested(""), 2500);
                  }}
                >
                  {justTested === rule.domain ? "✓ caught" : "Test"}
                </button>
                <Segmented<RuleMode>
                  value={rule.mode}
                  onChange={(mode) => actions.setRuleMode(rule.id, "web", mode)}
                  options={[
                    { value: "focus", label: "In focus" },
                    { value: "always", label: "Always" },
                  ]}
                />
                {rule.custom && (
                  <button className="btn sm ghost" onClick={() => actions.removeCustomRule(rule.id)} aria-label="Remove custom rule" title="Remove custom rule">
                    🗑️
                  </button>
                )}
                <Toggle on={rule.enabled} label={`Block ${rule.label}`} onChange={() => actions.toggleWebRule(rule.id)} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "reels" && (
        <div className="grid cols-2" style={{ gap: 16 }}>
          <Card head="Block Reels & Shorts" hint="Keep educational long-form, remove the infinite scroll">
            {!isPro && (
              <ProLock
                title="Blocking Reels & Shorts"
                body="Free keeps the app and website blockers. Removing Reels, Shorts, Spotlight and Facebook Reels is part of Pro."
              />
            )}
            <div className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Toggle
                on={isPro && state.settings.blockReelsShorts}
                disabled={!isPro}
                label="Short-form video shield"
                onChange={(v) => actions.updateSettings({ blockReelsShorts: v })}
              />
              <div>
                <div style={{ fontWeight: 560, fontSize: 13.5 }}>Short-form video shield</div>
                <div className="small muted">
                  Reels tabs, Shorts shelves, Spotlight and Facebook Reels are hidden; Shorts URLs
                  redirect to the normal home feed.
                </div>
              </div>
            </div>
            <div className="list">
              {REELS_TARGETS.map((t) => {
                const rule = state.webRules.find((r) => r.domain === t.host);
                const on = isPro && Boolean(rule?.enabled) && state.settings.blockReelsShorts;
                return (
                  <div className="list-row" key={t.id}>
                    <div className="icon">{t.icon}</div>
                    <div className="meta">
                      <div className="title">{t.label}</div>
                      <div className="sub mono">{t.host}</div>
                    </div>
                    <Chip tone={on ? "good" : "warn"}>{on ? "shielded" : "visible"}</Chip>
                  </div>
                );
              })}
            </div>
            <p className="small muted" style={{ marginTop: 14 }}>
              The companion browser extension mirrors this switch: when a focus session starts, the
              extension hides Reels/Shorts instantly and pauses any playing short.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <Chip tone="accent">Chrome / Edge MV3</Chip>
              <Chip>No page content is ever read</Chip>
            </div>
          </Card>

          <Card head="What is hidden" hint="Selectors the extension applies">
            <div className="list">
              {[
                { icon: "🧭", title: "Shorts / Reels nav entry", sub: "ytd-guide-entry-renderer, a[href^='/shorts']" },
                { icon: "🧱", title: "Shorts shelf on home & search", sub: "ytd-reel-shelf-renderer, grid-shelf-renderer" },
                { icon: "🎬", title: "Shorts player itself", sub: "ytd-shorts, #shorts-container" },
                { icon: "📸", title: "Instagram Reels tab & tray", sub: "a[href*='/reels/'], feed reels tray" },
                { icon: "🔁", title: "Auto-redirect of /shorts/ URLs", sub: "content.js → youtube.com home" },
              ].map((r) => (
                <div className="list-row" key={r.title}>
                  <div className="icon">{r.icon}</div>
                  <div className="meta">
                    <div className="title">{r.title}</div>
                    <div className="sub mono">{r.sub}</div>
                  </div>
                  <Chip tone="good">on</Chip>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "study" && (
        <div className="grid cols-2" style={{ gap: 16 }}>
          <Card
            head="YouTube Study Mode"
            hint="Only the channels you allow are playable — Shorts and the recommendation feed are removed"
          >
            {!isPro && (
              <ProLock
                title="YouTube Study Mode"
                body="The channel allow-list, hidden recommendations and removed comments are part of Pro."
              />
            )}
            <div className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Toggle
                on={isPro && state.settings.youtubeStudyMode}
                disabled={!isPro}
                label="YouTube Study Mode"
                onChange={(v) => actions.updateSettings({ youtubeStudyMode: v })}
              />
              <span className="small">Study Mode while a focus session is running</span>
            </div>
            <div className="list">
              {state.channels.map((c) => (
                <div className="list-row" key={c.id}>
                  <div className="icon">🎓</div>
                  <div className="meta">
                    <div className="title">{c.name}</div>
                    <div className="sub mono">{c.handle}</div>
                  </div>
                  <button
                    className="btn sm ghost"
                    onClick={() => actions.removeChannel(c.id)}
                    aria-label={`Remove ${c.name}`}
                    title="Remove channel"
                  >
                    🗑️
                  </button>
                  <Toggle
                    on={isPro && c.enabled}
                    disabled={!isPro}
                    label={`Allow ${c.name}`}
                    onChange={() => actions.toggleChannel(c.id)}
                  />
                </div>
              ))}
              {state.channels.length === 0 && (
                <Empty icon="🎓" title="No channels allowed yet" body="Add the channels you actually study from." />
              )}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <input
                className="input"
                placeholder="@PhysicsWallah"
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    actions.addChannel(newChannel);
                    setNewChannel("");
                  }
                }}
              />
              <button
                className="btn primary"
                onClick={() => {
                  actions.addChannel(newChannel);
                  setNewChannel("");
                }}
              >
                Allow channel
              </button>
            </div>
          </Card>

          <Card head="Study Mode behaviour">
            <div className="small muted" style={{ lineHeight: 1.8 }}>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>Home feed and Shorts shelf are replaced with your allowed channels only.</li>
                <li>Watch-next autoplay is disabled so lectures do not bleed into entertainment.</li>
                <li>Comments and trending are hidden — they are the fastest route back to scrolling.</li>
                <li>Shorts URLs redirect to the classic watch view instead of the swipe player.</li>
                <li>Study Mode releases automatically the moment your session ends.</li>
              </ul>
            </div>
            <div className="grid cols-2" style={{ marginTop: 16, gap: 10 }}>
              <div className="chip good">✅ Lectures stay playable</div>
              <div className="chip bad">🚫 Shorts removed</div>
              <div className="chip bad">🚫 Recommendations removed</div>
              <div className="chip good">✅ Search inside allowed channels</div>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => {
          setShowAdd(false);
          setAddError("");
          setAddedNote("");
        }}
        title={tab === "websites" ? "Add a website to block" : "Add an app to block"}
      >
        {tab === "websites" ? (
          <div className="grid" style={{ gap: 12 }}>
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>Domain or link</div>
              <input
                className="input"
                placeholder="https://www.chess.com/play"
                value={newSite}
                autoFocus
                onChange={(e) => {
                  setNewSite(e.target.value);
                  setAddError("");
                }}
              />
            </label>
            <div className="small muted">
              Paste a full link — it is reduced to the domain, and subdomains are covered
              automatically (“chess.com” also blocks play.chess.com).
            </div>
            {newSite && !normalizeDomain(newSite) && (
              <div className="chip bad">That does not look like a domain — try chess.com</div>
            )}
            {normalizeDomain(newSite) && suggestedAppsForDomain(newSite).length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                <div className="small">
                  A website rule cannot stop the desktop app. Also block:
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {suggestedAppsForDomain(newSite).map((process) => (
                    <button
                      key={process}
                      className="btn sm"
                      title={`Add ${process} to the app blocker`}
                      onClick={() => {
                        actions.addCustomApp(process, process.replace(/\.exe$/i, ""));
                        setAddedNote(`${process} added to the app blocker`);
                        window.setTimeout(() => setAddedNote(""), 3000);
                      }}
                    >
                      🧩 Block {process}
                    </button>
                  ))}
                </div>
                {addedNote && <div className="chip good">✓ {addedNote}</div>}
              </div>
            )}
            {addError && <div className="chip bad">{addError}</div>}
          </div>
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>Process, app or title keyword</div>
              <input
                className="input"
                placeholder="Chess.exe · chess.com · Spotify"
                value={newApp}
                autoFocus
                onChange={(e) => {
                  setNewApp(e.target.value);
                  setAddError("");
                }}
              />
            </label>
            <div className="small muted">
              Partial names work: “chess” catches Chess.exe, chess.com.exe and any window whose title mentions
              chess. Find exact names in Task Manager → Details.
            </div>
            {addError && <div className="chip bad">{addError}</div>}
          </div>
        )}
        <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
          <button
            className="btn primary"
            onClick={() => {
              if (tab === "websites") {
                if (!normalizeDomain(newSite)) {
                  setAddError("Enter a real domain, e.g. chess.com or lichess.org");
                  return;
                }
                actions.addCustomWeb(newSite, "");
              } else {
                if (!newApp.trim()) {
                  setAddError("Type a process name or a keyword from the window title");
                  return;
                }
                actions.addCustomApp(newApp, "");
              }
              setNewSite("");
              setNewApp("");
              setAddError("");
              setAddedNote("");
              setShowAdd(false);
            }}
          >
            Add to blocklist
          </button>
        </div>
      </Modal>
    </div>
  );
}

function should_label(cat: string) {
  return cat === "adult" ? "Adult sites" : cat === "social" ? "Social media" : "Streaming";
}
