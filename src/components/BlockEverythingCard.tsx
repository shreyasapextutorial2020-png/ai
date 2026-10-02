import { useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Toggle } from "../components/ui";
import { normalizeDomain } from "../lib/blocking";

/**
 * "Block everything else" — the answer to "not all sites are blocked".
 *
 * A blocklist can only cover domains somebody listed. This mode inverts it
 * while a focus session runs: the extension blocks every site except the
 * allowlist below, so a distraction that is not in the catalogue still cannot
 * be opened. The allowlist is editable and includes the usual study material.
 */
export function BlockEverythingCard() {
  const { state, actions, isFocusActive } = useStore();
  const [newSite, setNewSite] = useState("");
  const [error, setError] = useState("");
  const allowlist = state.settings.siteAllowlist;

  const add = () => {
    if (!normalizeDomain(newSite)) {
      setError("Enter a domain like khanacademy.org");
      return;
    }
    actions.addAllowlistSite(newSite);
    setNewSite("");
    setError("");
  };

  return (
    <Card
      head="Block everything else"
      hint="While a session runs, every site is blocked except the ones you allow — even sites that are not on any list"
      actions={
        <div className="row" style={{ gap: 10 }}>
          <Chip tone={state.settings.blockAllSites && isFocusActive ? "bad" : state.settings.blockAllSites ? "warn" : ""}>
            {state.settings.blockAllSites
              ? isFocusActive
                ? "Armed — only your study sites work"
                : "Armed — starts with your next session"
              : "Off"}
          </Chip>
          <Toggle
            on={state.settings.blockAllSites}
            label="Block every site except the allowlist"
            onChange={(v) => actions.updateSettings({ blockAllSites: v })}
          />
        </div>
      }
    >
      <div className="small muted" style={{ lineHeight: 1.7, marginBottom: 12 }}>
        Use this when you keep finding new ways to wander off. Everything on the internet is closed during a
        focus session except the sites below — the app's own catalogue of blocks still applies the rest of the
        time. The extension must be loaded for this to work.
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Add a study site, e.g. khanacademy.org"
          value={newSite}
          aria-label="Add a site to the allowlist"
          onChange={(e) => {
            setNewSite(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button className="btn primary" onClick={add}>
          Allow site
        </button>
      </div>
      {error && <div className="chip bad" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="row wrap" style={{ gap: 8 }}>
        {allowlist.length === 0 && (
          <span className="small muted">
            Nothing allowed yet — with this mode on, that blocks the entire web during a session.
          </span>
        )}
        {allowlist.map((domain) => (
          <span key={domain} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            ✅ {domain}
            <button
              className="btn sm ghost"
              style={{ padding: "0 6px" }}
              aria-label={`Stop allowing ${domain}`}
              title={`Remove ${domain} from the allowlist`}
              onClick={() => actions.removeAllowlistSite(domain)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </Card>
  );
}
