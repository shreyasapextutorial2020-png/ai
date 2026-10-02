import { useEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------- layout -------------------------------- */

export function Card({
  children,
  className = "",
  head,
  hint,
  actions,
}: {
  children: ReactNode;
  className?: string;
  head?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(head || actions) && (
        <div className="card-head">
          <div>
            {head && <h3>{head}</h3>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          <div className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div>
      <div className="row" style={{ gap: 7 }}>
        {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={{ marginTop: 6 }}>
        {value}
      </div>
      {sub && <div className="small muted" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------ controls -------------------------------- */

export function Toggle({
  on,
  onChange,
  disabled,
  title,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  /** accessible name for switches that have no visible label of their own */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label ?? title}
      title={title}
      disabled={disabled}
      className={`toggle ${on ? "on" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => !disabled && onChange(!on)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  children,
  tone = "",
  className = "",
}: {
  children: ReactNode;
  tone?: "" | "good" | "warn" | "bad" | "accent";
  className?: string;
}) {
  return <span className={`chip ${tone} ${className}`}>{children}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { width: "min(760px, 100%)" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-head">
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={onClose} aria-label="Close dialog" title="Close">
            ✕
          </button>
        </div>
        {children}
        {footer && (
          <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ progress -------------------------------- */

export function Ring({
  progress,
  size = 260,
  stroke = 12,
  children,
  colour,
  track,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  colour?: string;
  track?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg className="ring" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={track ?? "rgba(255,255,255,0.09)"}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={colour ?? "var(--accent)"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: "stroke-dashoffset .4s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Bar({ value, max = 1, colour }: { value: number; max?: number; colour?: string }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <span style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

/* -------------------------------- toasts -------------------------------- */

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "good" | "bad";
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);

  const push = (t: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    const timer = window.setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      4200,
    );
    timers.current.push(timer);
  };

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const node = (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          style={
            t.tone === "good"
              ? { borderColor: "rgba(47,191,143,.5)" }
              : t.tone === "bad"
                ? { borderColor: "rgba(251,113,133,.5)" }
                : undefined
          }
        >
          <strong style={{ fontSize: 13.5 }}>{t.title}</strong>
          {t.body && <div className="small muted" style={{ marginTop: 2 }}>{t.body}</div>}
        </div>
      ))}
    </div>
  );

  return { push, node };
}

/* ------------------------------ misc bits ------------------------------- */

export function IconTile({ icon, size = 36 }: { icon: string; size?: number }) {
  return (
    <div className="icon" style={{ width: size, height: size, fontSize: size * 0.48 }}>
      {icon}
    </div>
  );
}

export function Empty({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "34px 12px", opacity: 0.85 }}>
      <div style={{ fontSize: 34 }}>{icon}</div>
      <div style={{ marginTop: 8, fontWeight: 600 }}>{title}</div>
      {body && <div className="small muted" style={{ marginTop: 4 }}>{body}</div>}
    </div>
  );
}

export function KeyVal({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "5px 0" }}>
      <span className="small muted">{k}</span>
      <span className="small mono" style={{ fontWeight: 560 }}>
        {v}
      </span>
    </div>
  );
}
