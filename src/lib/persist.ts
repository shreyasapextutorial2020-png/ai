/**
 * Persistence + migration.
 *
 * The store writes one JSON blob to localStorage. Keeping load/migrate in a
 * pure module (no React, no Tauri) makes the upgrade path unit-testable and
 * means a version bump never throws away a user's history.
 */

import {
  DEFAULT_POMODORO,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  STATE_VERSION,
  initialState,
  todayKey,
} from "./defaults";
import { seedDemoState } from "./demo";
import type { PersistedState, UsageSlice } from "./types";

export type BridgeMode = PersistedState["bridgeMode"];

/** Oldest state shape we still accept without discarding user history. */
const OLDEST_SUPPORTED_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Brings any previously saved blob up to the current schema.
 * Unknown/partial data is filled from defaults; only a hopeless blob is dropped.
 */
export function migrateState(raw: unknown, bridgeMode: BridgeMode): PersistedState | null {
  if (!isRecord(raw)) return null;

  const version = typeof raw.version === "number" ? raw.version : 0;
  if (version < OLDEST_SUPPORTED_VERSION || version > STATE_VERSION) return null;

  const fresh = initialState(bridgeMode);
  const settings = isRecord(raw.settings) ? raw.settings : {};

  const merged: PersistedState = {
    ...fresh,
    ...(raw as Partial<PersistedState>),
    // deep-merge the settings so newly added switches get their defaults
    settings: { ...DEFAULT_SETTINGS, ...settings } as PersistedState["settings"],
    pomodoro: {
      ...DEFAULT_POMODORO,
      ...(isRecord(raw.pomodoro) ? raw.pomodoro : {}),
    } as PersistedState["pomodoro"],
    // arrays must exist even when an older blob omitted them
    sessions: Array.isArray(raw.sessions) ? (raw.sessions as PersistedState["sessions"]) : [],
    usage: Array.isArray(raw.usage) ? (raw.usage as UsageSlice[]) : [],
    blockedLog: Array.isArray(raw.blockedLog) ? (raw.blockedLog as PersistedState["blockedLog"]) : [],
    reminders: Array.isArray(raw.reminders) ? (raw.reminders as PersistedState["reminders"]) : [],
    blocks: Array.isArray(raw.blocks) ? (raw.blocks as PersistedState["blocks"]) : fresh.blocks,
    appRules: Array.isArray(raw.appRules) ? (raw.appRules as PersistedState["appRules"]) : fresh.appRules,
    webRules: Array.isArray(raw.webRules) ? (raw.webRules as PersistedState["webRules"]) : fresh.webRules,
    channels: Array.isArray(raw.channels) ? (raw.channels as PersistedState["channels"]) : fresh.channels,
    streak: isRecord(raw.streak) ? { ...fresh.streak, ...raw.streak } : fresh.streak,
    // v1 → v2: a running session keeps running, an idle app stays idle
    active: isRecord(raw.active) ? (raw.active as unknown as PersistedState["active"]) : null,
    room: isRecord(raw.room) ? (raw.room as unknown as PersistedState["room"]) : null,
    bridgeMode,
    version: STATE_VERSION,
  };

  return merged;
}

/** Reads localStorage, migrating or bootstrapping as needed. */
export function loadState(bridgeMode: BridgeMode): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const migrated = migrateState(JSON.parse(raw), bridgeMode);
      if (migrated) return migrated;
    }
  } catch (error) {
    console.warn("[regain] saved state could not be read — starting fresh", error);
  }
  const fresh = initialState(bridgeMode);
  // the browser preview ships with sample history so charts are never empty
  return bridgeMode === "browser" ? seedDemoState(fresh) : fresh;
}

/** Drops usage older than 60 days and caps unbounded arrays. */
export function pruneState(state: PersistedState): PersistedState {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cut = todayKey(cutoff);
  return {
    ...state,
    usage: state.usage.filter((u) => u.date >= cut),
    sessions: state.sessions.slice(-400),
    blockedLog: state.blockedLog.slice(-200),
    reminders: state.reminders.slice(-20),
  };
}

export function saveState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruneState(state)));
  } catch (error) {
    console.warn("[regain] could not persist state", error);
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
