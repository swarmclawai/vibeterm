import { create } from "zustand";
import type { CompanionInfo, SessionInfo, TaskMetadata } from "../lib/tauri";
import { DEFAULT_THEME, THEMES, type AppTheme } from "../lib/themes";

export interface GridLayout {
  rows: number;
  cols: number;
}

export interface PaneSlot {
  sessionId: string | null;
}

export interface AppSettings {
  gap: number;
  borderRadius: number;
  glowEnabled: boolean;
  glowIntensity: number;
  glowWidth: number;
  fontSize: number;
  fontFamily: string;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
}

export type CompanionSide = "left" | "right" | "floating";

export interface CompanionState {
  open: boolean;
  side: CompanionSide;
  width: number;
  height: number;
  floatingX: number;
  floatingY: number;
  selectedAppId: string;
  launchedAppId: string;
  currentUrl: string;
  currentEmbedUrl: string;
  contentLabel: string;
  search: string;
  status: string | null;
  companions: CompanionInfo[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  gap: 8,
  borderRadius: 6,
  glowEnabled: true,
  glowIntensity: 1,
  glowWidth: 8,
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  cursorStyle: "block",
  scrollback: 1000,
};

export const DEFAULT_COMPANION: CompanionState = {
  open: false,
  side: "right",
  width: 320,
  height: 420,
  floatingX: 56,
  floatingY: 56,
  selectedAppId: "",
  launchedAppId: "",
  currentUrl: "",
  currentEmbedUrl: "",
  contentLabel: "",
  search: "",
  status: null,
  companions: [],
};

export interface PendingGridChange {
  rows: number;
  cols: number;
  removedSessionIds: string[];
}

export interface AppState {
  sessions: Record<string, SessionInfo>;
  grid: GridLayout;
  panes: PaneSlot[];
  maximizedPane: number | null;
  focusedPane: number;
  theme: AppTheme;
  themePreview: AppTheme | null;
  customThemes: AppTheme[];
  settings: AppSettings;
  draggingPane: number | null;
  sessionCwds: Record<string, string>;
  companion: CompanionState;
  pendingGridChange: PendingGridChange | null;

  addSession: (info: SessionInfo, paneIndex: number) => void;
  removeSession: (id: string) => void;
  updateTaskStatus: (id: string, status: TaskMetadata["status"]) => void;
  setGrid: (rows: number, cols: number) => void;
  toggleMaximize: (paneIndex: number) => void;
  setFocusedPane: (index: number) => void;
  getNextEmptySlot: () => number;
  getSessionsOutsideGrid: (rows: number, cols: number) => string[];
  setTheme: (theme: AppTheme) => void;
  setThemePreview: (theme: AppTheme | null) => void;
  saveCustomTheme: (theme: AppTheme) => void;
  deleteCustomTheme: (name: string) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
  swapPanes: (from: number, to: number) => void;
  setDraggingPane: (index: number | null) => void;
  setSessionCwd: (sessionId: string, cwd: string) => void;
  setCompanionState: (partial: Partial<CompanionState>) => void;
  toggleCompanion: () => void;
  closeCompanion: () => void;
  setPendingGridChange: (pending: PendingGridChange | null) => void;
}

function makeSlots(count: number, existing: PaneSlot[] = []): PaneSlot[] {
  const slots: PaneSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    slots.push(existing[i] ?? { sessionId: null });
  }
  return slots;
}

function clampCompanionWidth(value: number): number {
  return Math.max(280, Math.min(720, Math.round(value)));
}

function clampCompanionHeight(value: number): number {
  return Math.max(260, Math.min(720, Math.round(value)));
}

const CUSTOM_THEMES_STORAGE_KEY = "vibeterm-custom-themes";
const ACTIVE_THEME_STORAGE_KEY = "vibeterm-active-theme";

function cloneTheme(theme: AppTheme): AppTheme {
  return {
    ...theme,
    terminal: { ...theme.terminal },
    ui: { ...theme.ui },
  };
}

function readCustomThemes(): AppTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is AppTheme => Boolean(value?.name && value?.terminal && value?.ui))
      .map((theme) => ({
        ...cloneTheme(theme),
        custom: true,
      }));
  } catch {
    return [];
  }
}

function writeCustomThemes(themes: AppTheme[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
}

function readActiveThemeName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_THEME_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function writeActiveThemeName(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_THEME_STORAGE_KEY, name);
}

const INITIAL_CUSTOM_THEMES = readCustomThemes();
const INITIAL_ACTIVE_THEME_NAME = readActiveThemeName();
const INITIAL_THEME =
  [...THEMES, ...INITIAL_CUSTOM_THEMES].find((theme) => theme.name === INITIAL_ACTIVE_THEME_NAME)
  ?? DEFAULT_THEME;

function normalizeCompanionState(partial: Partial<CompanionState>): Partial<CompanionState> {
  const next = { ...partial };
  if (next.width !== undefined) {
    next.width = clampCompanionWidth(next.width);
  }
  if (next.height !== undefined) {
    next.height = clampCompanionHeight(next.height);
  }
  if (next.floatingX !== undefined) {
    next.floatingX = Math.max(0, Math.round(next.floatingX));
  }
  if (next.floatingY !== undefined) {
    next.floatingY = Math.max(0, Math.round(next.floatingY));
  }
  if (next.side && !["left", "right", "floating"].includes(next.side)) {
    next.side = "right";
  }
  return next;
}

export const useStore = create<AppState>((set, get) => ({
  sessions: {},
  grid: { rows: 1, cols: 1 },
  panes: [{ sessionId: null }],
  maximizedPane: null,
  focusedPane: 0,
  theme: INITIAL_THEME,
  pendingGridChange: null,
  themePreview: null,
  customThemes: INITIAL_CUSTOM_THEMES,
  settings: DEFAULT_SETTINGS,
  draggingPane: null,
  sessionCwds: {},
  companion: DEFAULT_COMPANION,

  addSession: (info, paneIndex) =>
    set((state) => {
      const panes = [...state.panes];
      if (paneIndex < panes.length) {
        panes[paneIndex] = { sessionId: info.id };
      }
      return {
        sessions: { ...state.sessions, [info.id]: info },
        panes,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      const panes = state.panes.map((pane) =>
        pane.sessionId === id ? { sessionId: null } : pane,
      );
      return { sessions: rest, panes };
    }),

  updateTaskStatus: (id, status) =>
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...session,
            task: { ...session.task, status },
          },
        },
      };
    }),

  setGrid: (rows, cols) =>
    set((state) => {
      const nextPaneCount = rows * cols;
      const removedIds = state.panes
        .slice(nextPaneCount)
        .map((pane) => pane.sessionId)
        .filter((id): id is string => Boolean(id));
      const removedSet = new Set(removedIds);
      const nextSessions = Object.fromEntries(
        Object.entries(state.sessions).filter(([id]) => !removedSet.has(id)),
      );
      const nextSessionCwds = Object.fromEntries(
        Object.entries(state.sessionCwds).filter(([id]) => !removedSet.has(id)),
      );

      return {
        grid: { rows, cols },
        panes: makeSlots(nextPaneCount, state.panes),
        maximizedPane: null,
        sessions: nextSessions,
        sessionCwds: nextSessionCwds,
        focusedPane: Math.min(state.focusedPane, Math.max(0, nextPaneCount - 1)),
      };
    }),

  toggleMaximize: (paneIndex) =>
    set((state) => ({
      maximizedPane: state.maximizedPane === paneIndex ? null : paneIndex,
    })),

  setFocusedPane: (index) => set({ focusedPane: index }),

  setTheme: (theme) => {
    writeActiveThemeName(theme.name);
    set({ theme });
  },

  setThemePreview: (themePreview) => set({ themePreview }),

  saveCustomTheme: (theme) =>
    set((state) => {
      const nextTheme = {
        ...cloneTheme(theme),
        custom: true,
      };
      const nextCustomThemes = [
        nextTheme,
        ...state.customThemes.filter((entry) => entry.name !== nextTheme.name),
      ];
      writeCustomThemes(nextCustomThemes);
      writeActiveThemeName(nextTheme.name);
      return {
        customThemes: nextCustomThemes,
        theme: nextTheme,
      };
    }),

  deleteCustomTheme: (name) =>
    set((state) => {
      const nextCustomThemes = state.customThemes.filter((theme) => theme.name !== name);
      writeCustomThemes(nextCustomThemes);
      const nextTheme = state.theme.name === name ? DEFAULT_THEME : state.theme;
      writeActiveThemeName(nextTheme.name);
      return {
        customThemes: nextCustomThemes,
        theme: nextTheme,
      };
    }),

  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  swapPanes: (from, to) =>
    set((state) => {
      if (from === to) return state;
      const panes = [...state.panes];
      [panes[from], panes[to]] = [panes[to], panes[from]];
      return { panes, focusedPane: to };
    }),

  setDraggingPane: (index) => set({ draggingPane: index }),

  setSessionCwd: (sessionId, cwd) =>
    set((state) => ({
      sessionCwds: { ...state.sessionCwds, [sessionId]: cwd },
    })),

  setCompanionState: (partial) =>
    set((state) => ({
      companion: {
        ...state.companion,
        ...normalizeCompanionState(partial),
      },
    })),

  toggleCompanion: () =>
    set((state) => ({
      companion: {
        ...state.companion,
        open: !state.companion.open,
      },
    })),

  closeCompanion: () =>
    set((state) => ({
      companion: {
        ...state.companion,
        open: false,
      },
    })),

  setPendingGridChange: (pending) => set({ pendingGridChange: pending }),

  getNextEmptySlot: () => {
    const { panes, grid } = get();
    const idx = panes.findIndex((pane) => pane.sessionId === null);
    if (idx !== -1) return idx;

    const { rows, cols } = grid;
    if (cols < 8) {
      get().setGrid(rows, cols + 1);
    } else if (rows < 8) {
      get().setGrid(rows + 1, cols);
    } else {
      return -1;
    }

    const updated = get().panes;
    const newIdx = updated.findIndex((pane) => pane.sessionId === null);
    return newIdx !== -1 ? newIdx : -1;
  },

  getSessionsOutsideGrid: (rows, cols) => {
    const nextPaneCount = rows * cols;
    return get().panes
      .slice(nextPaneCount)
      .map((pane) => pane.sessionId)
      .filter((id): id is string => Boolean(id));
  },
}));
