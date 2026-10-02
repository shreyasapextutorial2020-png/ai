import { useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, KeyVal, Toggle } from "../components/ui";
import { requestNotificationPermission, isTauri } from "../lib/desktop";
import { ACCENTS } from "../lib/defaults";

const AVATARS = ["🦊", "🐼", "🦉", "🐯", "🦋", "🐺", "🐨", "🐬", "🦁", "🐧"];

export function SettingsPage() {
  const { state, actions } = useStore();
  const s = state.settings;
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
      <div className="grid" style={{ gap: 16 }}>
        <Card head="Profile" hint="Used in study rooms and streaks">
          <div className="grid" style={{ gap: 14 }}>
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>Display name</div>
              <input
                className="input"
                value={s.nickname}
                onChange={(e) => actions.updateSettings({ nickname: e.target.value })}
              />
            </label>
            <div>
              <div className="stat-label" style={{ marginBottom: 8 }}>Avatar</div>
              <div className="row wrap" style={{ gap: 8 }}>
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => actions.updateSettings({ avatar: a })}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      fontSize: 19,
                      cursor: "pointer",
                      background: s.avatar === a ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "rgba(255,255,255,.05)",
                      border: s.avatar === a ? "1px solid var(--accent)" : "1px solid var(--border)",
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="row">
                <span className="stat-label">Daily focus goal</span>
                <div className="spacer" />
                <span className="small mono">{Math.floor(s.dailyGoalMinutes / 60)}h {s.dailyGoalMinutes % 60}m</span>
              </div>
              <input
                type="range"
                min={30}
                max={480}
                step={15}
                value={s.dailyGoalMinutes}
                onChange={(e) => actions.updateSettings({ dailyGoalMinutes: Number(e.target.value) })}
                style={{ marginTop: 8 }}
              />
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 8 }}>Accent</div>
              <div className="row wrap" style={{ gap: 8 }}>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => actions.updateSettings({ accent: c })}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 9,
                      background: c,
                      cursor: "pointer",
                      border: s.accent === c ? "2px solid #fff" : "1px solid var(--border)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card head="Focus behaviour">
          <div className="grid" style={{ gap: 16 }}>
            <Row
              title="Block during focus"
              body="App and website blocking engages the moment a session starts."
              on={s.blockDuringFocus}
              onChange={(v) => actions.updateSettings({ blockDuringFocus: v })}
            />
            <Row
              title="Focus Guard overlay"
              body="Full-screen interception screen when you open a blocked app."
              on={s.focusGuard}
              onChange={(v) => actions.updateSettings({ focusGuard: v })}
            />
            <Row
              title="Focus Guard reminders"
              body={
                s.pro
                  ? "Nudge me when I drift onto an unblocked but distracting app or site."
                  : "Pro feature — nudge me when I drift into distraction mid-session."
              }
              on={s.focusGuardReminders}
              disabled={!s.pro}
              onChange={(v) => actions.updateSettings({ focusGuardReminders: v })}
            />
            {s.focusGuardReminders && s.pro && (
              <div>
                <div className="row">
                  <span className="stat-label">Remind me after drifting for</span>
                  <div className="spacer" />
                  <span className="small mono">{s.focusGuardMinutes} min</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={45}
                  step={1}
                  value={s.focusGuardMinutes}
                  onChange={(e) => actions.updateSettings({ focusGuardMinutes: Number(e.target.value) })}
                  style={{ marginTop: 8 }}
                />
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Blocked apps are intercepted immediately; this only covers distraction you did not
                  block, so Study Mode browsers and notes stay untouched.
                </div>
              </div>
            )}
            <Row
              title="Notifications"
              body="Phase changes, goal reached and blocked attempts."
              on={s.notifications}
              onChange={async (v) => {
                actions.updateSettings({ notifications: v });
                if (v) await requestNotificationPermission();
              }}
            />
            <Row
              title="Chimes"
              body="Soft synth cue on session start, phase change and completion."
              on={s.tickSound}
              onChange={(v) => actions.updateSettings({ tickSound: v })}
            />
            <Row
              title="Block Reels & Shorts"
              body="Applies to Instagram, YouTube, Snapchat and Facebook."
              on={s.blockReelsShorts}
              onChange={(v) => actions.updateSettings({ blockReelsShorts: v })}
            />
            <Row
              title="YouTube Study Mode"
              body="Only allow your selected channels while focusing."
              on={s.youtubeStudyMode}
              onChange={(v) => actions.updateSettings({ youtubeStudyMode: v })}
            />
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card head="System" hint="Desktop integration">
          <div className="grid" style={{ gap: 16 }}>
            <Row
              title="Start with Windows"
              body="Regain launches minimised so blocking works before you get distracted."
              on={s.startAtLogin}
              onChange={(v) => actions.updateSettings({ startAtLogin: v })}
            />
            <Row
              title="Minimise to tray"
              body="Closing the window keeps the focus engine alive."
              on={s.minimiseToTray}
              onChange={(v) => actions.updateSettings({ minimiseToTray: v })}
            />
            <Row
              title="Strict Mode by default"
              body="Every new session inherits Strict Mode."
              on={s.strictMode}
              disabled={!s.pro}
              onChange={(v) => actions.updateSettings({ strictMode: v })}
            />
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>
                Room relay URL (optional)
              </div>
              <input
                className="input"
                placeholder="wss://your-relay.example.com"
                value={s.roomServerUrl}
                onChange={(e) => actions.updateSettings({ roomServerUrl: e.target.value })}
              />
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Leave empty to auto-detect a relay on port 8790 of this host.
              </div>
            </label>
          </div>
        </Card>

        <Card head="Keyboard shortcuts" hint="Work without leaving the keyboard">
          <div className="grid" style={{ gap: 8 }}>
            {[
              ["Space", "Quick 25 min session · pause · resume"],
              ["M", "Toggle the soundscape"],
              ["Esc", "Dismiss the Focus Guard overlay"],
              ["?", "Shortcut list"],
            ].map(([keys, what]) => (
              <div className="row" key={keys} style={{ gap: 12 }}>
                <span className="chip accent mono" style={{ minWidth: 74, justifyContent: "center" }}>
                  {keys}
                </span>
                <span className="small">{what}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card head="Desktop bridge">
          <KeyVal k="Runtime" v={isTauri() ? "Tauri desktop shell" : "Browser preview (simulated monitor)"} />
          <KeyVal k="Foreground monitor" v={isTauri() ? "Win32 GetForegroundWindow" : "simulated"} />
          <KeyVal k="Extension bridge" v="ws://127.0.0.1:48123" />
          <KeyVal k="Companion extension" v="regain-extension/ (MV3)" />
          <KeyVal k="Room relay" v="server/room-server.mjs · port 8790" />
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Chip tone="good">privacy: window title + process name only</Chip>
            <Chip>no content reading</Chip>
          </div>
        </Card>

        <Card head="Data">
          <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.7 }}>
            Everything is stored locally on this machine. {state.sessions.length} sessions and{" "}
            {state.usage.length} usage records are in the local database.
            {state.demoData && " Sample history is currently loaded so charts are not empty."}
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            {state.demoData && (
              <button className="btn" onClick={actions.clearDemoData}>
                🧹 Remove sample history
              </button>
            )}
            <button className="btn" onClick={() => downloadExport(state)}>
              ⬇️ Export JSON
            </button>
            {confirmReset ? (
              <>
                <button
                  className="btn danger"
                  onClick={() => {
                    actions.resetAllData();
                    setConfirmReset(false);
                  }}
                >
                  Yes, erase everything
                </button>
                <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmReset(true)}>
                🗑️ Reset all data
              </button>
            )}
          </div>
        </Card>

        <Card head="About">
          <KeyVal k="Version" v="1.0.0" />
          <KeyVal k="Core" v="regain-core (Rust + Tauri 2)" />
          <KeyVal k="Platforms" v="Windows · macOS · Linux · Android · iOS" />
          <KeyVal k="Plan" v={s.pro ? `Pro (${s.proPlan})` : "Free"} />
          <div className="small muted" style={{ marginTop: 12, lineHeight: 1.7 }}>
            Regain is a focus and digital-wellbeing app: strict app blocking, Pomodoro timers,
            multiplayer study rooms, screen-time tracking and Reels/Shorts blocking that still allows
            educational content.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({
  title,
  body,
  on,
  onChange,
  disabled,
}: {
  title: string;
  body: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
      <div>
        <div style={{ fontWeight: 560, fontSize: 13.5 }}>
          {title} {disabled ? <span className="tiny muted">(Pro)</span> : null}
        </div>
        <div className="small muted">{body}</div>
      </div>
    </div>
  );
}

function downloadExport(state: unknown) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `regain-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
