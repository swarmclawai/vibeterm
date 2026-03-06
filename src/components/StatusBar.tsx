import { useStore } from "../store";
import { getTerminalRuntime } from "../lib/tauri";

export function StatusBar() {
  const sessionCount = useStore((s) => Object.keys(s.sessions).length);
  const grid = useStore((s) => s.grid);
  const runtime = getTerminalRuntime();

  return (
    <div className="flex items-center gap-3 px-3 py-0.5 bg-[var(--vt-chrome-bg)] border-t border-[var(--vt-border)] text-[10px] text-[var(--vt-muted-text)] select-none shrink-0">
      <span>
        {sessionCount} session{sessionCount !== 1 ? "s" : ""}
      </span>
      <span className="opacity-50">|</span>
      <span>{grid.rows}×{grid.cols}</span>
      <span className="opacity-50">|</span>
      <span>{runtime}</span>
    </div>
  );
}
