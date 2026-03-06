import { useEffect, useCallback, useState } from "react";
import { AppSplash } from "./components/AppSplash";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { WorkspaceShell } from "./components/WorkspaceShell";
import { killSession } from "./lib/tauri";
import { changeGridWithWarning, confirmPendingGridChange, cancelPendingGridChange } from "./lib/grid";
import { getThemeGlow } from "./lib/themes";
import { useStore } from "./store";

function GridConfirmModal() {
  const pending = useStore((s) => s.pendingGridChange);
  const sessions = useStore((s) => s.sessions);

  if (!pending) return null;

  const labels = pending.removedSessionIds
    .map((id) => sessions[id]?.task.label?.trim() || "Terminal")
    .slice(0, 4);
  const extra = pending.removedSessionIds.length - labels.length;
  const count = pending.removedSessionIds.length;
  const noun = count === 1 ? "terminal" : "terminals";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-[380px] rounded-2xl border border-[var(--vt-input-border)] bg-[var(--vt-dropdown-bg)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
        <div className="text-[13px] font-semibold text-[var(--vt-foreground)]">
          Close {count} {noun}?
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[var(--vt-muted-text)]">
          Reducing to {pending.rows}&times;{pending.cols} will close:{" "}
          <span className="text-[var(--vt-foreground)]">
            {labels.join(", ")}
            {extra > 0 ? ` +${extra} more` : ""}
          </span>
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancelPendingGridChange}
            className="cursor-pointer rounded-lg border border-[var(--vt-input-border)] px-4 py-1.5 text-[12px] text-[var(--vt-muted-text)] transition-colors hover:text-[var(--vt-foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmPendingGridChange()}
            className="cursor-pointer rounded-lg bg-[var(--vt-accent)] px-4 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Close &amp; Resize
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const theme = useStore((s) => s.themePreview ?? s.theme);
  const settings = useStore((s) => s.settings);
  const removeSession = useStore((s) => s.removeSession);
  const panes = useStore((s) => s.panes);
  const focusedPane = useStore((s) => s.focusedPane);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximizedPane = useStore((s) => s.maximizedPane);
  const setGrid = useStore((s) => s.setGrid);

  useEffect(() => {
    let timeoutId = 0;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => setBooting(false), 720);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleClosePane = useCallback(async () => {
    const pane = panes[focusedPane];
    if (pane?.sessionId) {
      await killSession(pane.sessionId).catch(() => {});
      removeSession(pane.sessionId);
    }
  }, [panes, focusedPane, removeSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+N — expand grid to add a terminal
      if (meta && e.key === "n") {
        e.preventDefault();
        const { grid } = useStore.getState();
        const hasEmpty = useStore.getState().panes.some((p) => !p.sessionId);
        if (!hasEmpty) {
          if (grid.cols < 8) setGrid(grid.rows, grid.cols + 1);
          else if (grid.rows < 8) setGrid(grid.rows + 1, grid.cols);
        }
        return;
      }

      if (meta && e.key === "w") {
        e.preventDefault();
        handleClosePane();
        return;
      }

      if (meta && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        toggleMaximize(focusedPane);
        return;
      }

      if (e.key === "Escape" && maximizedPane !== null) {
        e.preventDefault();
        toggleMaximize(maximizedPane);
        return;
      }

      // Escape also dismisses the grid confirm modal
      if (e.key === "Escape" && useStore.getState().pendingGridChange) {
        e.preventDefault();
        cancelPendingGridChange();
        return;
      }

      if (meta && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < panes.length) {
          setFocusedPane(idx);
        }
        return;
      }

      if (meta && !e.shiftKey) {
        const { grid } = useStore.getState();
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusedPane(Math.max(0, focusedPane - 1));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusedPane(Math.min(panes.length - 1, focusedPane + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusedPane(Math.max(0, focusedPane - grid.cols));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusedPane(Math.min(panes.length - 1, focusedPane + grid.cols));
          return;
        }
      }

      // Cmd+Shift+L — cycle grid sizes
      if (meta && e.shiftKey && e.key === "L") {
        e.preventDefault();
        const { grid } = useStore.getState();
        const cycle = [
          [1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 3],
        ] as const;
        const cur = cycle.findIndex(
          ([r, c]) => r === grid.rows && c === grid.cols,
        );
        const [r, c] = cycle[(cur + 1) % cycle.length];
        void changeGridWithWarning(r, c);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    handleClosePane,
    toggleMaximize,
    focusedPane,
    maximizedPane,
    panes,
    setFocusedPane,
    setGrid,
  ]);

  useEffect(() => {
    const root = document.documentElement;
    const { ui } = theme;
    const glow = getThemeGlow(theme);
    root.style.setProperty("--vt-bg", ui.bg);
    root.style.setProperty("--vt-chrome-bg", ui.chromeBg);
    root.style.setProperty("--vt-dropdown-bg", ui.dropdownBg);
    root.style.setProperty("--vt-border", ui.border);
    root.style.setProperty("--vt-input-border", ui.inputBorder);
    root.style.setProperty("--vt-dim-text", ui.dimText);
    root.style.setProperty("--vt-muted-text", ui.mutedText);
    root.style.setProperty("--vt-foreground", ui.foreground);
    root.style.setProperty("--vt-accent", ui.accent);
    root.style.setProperty("--vt-selection", ui.selection);
    root.style.setProperty("--vt-separator", ui.separator);
    root.style.setProperty("--vt-separator-active", ui.separatorActive);

    const t = theme.terminal;
    root.style.setProperty("--vt-red", t.red ?? "#ff5555");
    root.style.setProperty("--vt-green", t.green ?? "#50fa7b");
    root.style.setProperty("--vt-yellow", t.yellow ?? "#f1fa8c");
    root.style.setProperty("--vt-blue", t.blue ?? "#6272a4");
    root.style.setProperty("--vt-magenta", t.magenta ?? "#ff79c6");
    root.style.setProperty("--vt-cyan", t.cyan ?? "#8be9fd");
    root.style.setProperty("--vt-glow-primary", glow.primary);
    root.style.setProperty("--vt-glow-secondary", glow.secondary);
    root.style.setProperty("--vt-glow-tertiary", glow.tertiary);
    root.style.setProperty("--vt-glow-halo", glow.halo);
    root.style.setProperty("--vt-glow-width", `${settings.glowWidth}px`);

    root.style.setProperty("--vt-border-radius", `${settings.borderRadius}px`);
    root.style.setProperty("--vt-gap", `${settings.gap}px`);
  }, [theme, settings]);

  return (
    <div className="relative flex h-screen min-h-0 flex-col overflow-hidden">
      <AppSplash visible={booting} />
      <TopBar />
      <div className="flex flex-1 min-h-0 min-w-0 p-2">
        <WorkspaceShell />
      </div>
      <StatusBar />
      <GridConfirmModal />
    </div>
  );
}
