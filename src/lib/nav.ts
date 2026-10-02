export type PageId =
  | "focus"
  | "pomodoro"
  | "planner"
  | "music"
  | "blocking"
  | "strict"
  | "screentime"
  | "insights"
  | "rooms"
  | "themes"
  | "settings"
  | "pro";

export interface NavItemDef {
  id: PageId;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
  pro?: boolean;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
}

export const NAV: NavGroupDef[] = [
  {
    label: "Focus",
    items: [
      {
        id: "focus",
        label: "Focus Timer",
        icon: "⏱️",
        title: "Focus Timer",
        subtitle: "Study, stopwatch and countdown sessions with strict blocking",
      },
      {
        id: "pomodoro",
        label: "Pomodoro",
        icon: "🍅",
        title: "Pomodoro Timer",
        subtitle: "Adjustable focus / break cycles with automatic phase changes",
        pro: true,
      },
      {
        id: "planner",
        label: "Focus Planner",
        icon: "🗓️",
        title: "Focus Planner",
        subtitle: "Schedule daily and weekly focus blocks, tick them off as you go",
      },
      {
        id: "music",
        label: "Focus Music",
        icon: "🎧",
        title: "Focus Music",
        subtitle: "Science-backed soundscapes generated live — rain, lo-fi, brown noise",
        pro: true,
      },
    ],
  },
  {
    label: "Discipline",
    items: [
      {
        id: "blocking",
        label: "Blocking",
        icon: "🚫",
        title: "Blocking",
        subtitle: "Apps, websites, Reels/Shorts and YouTube Study Mode in one place",
      },
      {
        id: "strict",
        label: "Strict Mode",
        icon: "🔒",
        title: "Strict Mode",
        subtitle: "Lock a session so you cannot quit early — or uninstall the app",
        pro: true,
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        id: "screentime",
        label: "Screen Time",
        icon: "📊",
        title: "Screen Time",
        subtitle: "Usage analytics, blocked attempts and session history",
      },
      {
        id: "insights",
        label: "Progress",
        icon: "🔥",
        title: "Progress & Streaks",
        subtitle: "Focus trends, subject balance and streak history",
      },
    ],
  },
  {
    label: "Together",
    items: [
      {
        id: "rooms",
        label: "Study Rooms",
        icon: "👥",
        title: "Multiplayer Focus Rooms",
        subtitle: "Study with friends live — shared timer, chat and leaderboard",
      },
    ],
  },
  {
    label: "App",
    items: [
      { id: "themes", label: "Themes", icon: "🎨", title: "Themes & Personalisation", subtitle: "Wallpapers, accents and premium looks" },
      { id: "settings", label: "Settings", icon: "⚙️", title: "Settings", subtitle: "Notifications, startup, data and the desktop bridge" },
      { id: "pro", label: "Regain Pro", icon: "✨", title: "Regain Pro", subtitle: "Unlock Pomodoro, Strict Mode, sounds and premium themes" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

export function navItem(id: PageId): NavItemDef {
  return ALL_NAV_ITEMS.find((i) => i.id === id) ?? ALL_NAV_ITEMS[0];
}

/**
 * Route helper usable from anywhere (including non-React code): the shell
 * listens for hash changes and switches pages.
 */
export function navigateTo(page: PageId) {
  if (typeof window === "undefined") return;
  if (window.location.hash === `#${page}`) return;
  // Setting the hash is enough: every webview fires hashchange for us, and if
  // the hash is already correct the shell is already on that page.
  window.location.hash = `#${page}`;
}
