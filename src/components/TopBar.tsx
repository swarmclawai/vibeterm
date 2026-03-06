import { useState, useRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useStore } from "../store";
import { changeGridWithWarning } from "../lib/grid";
import { MAX_GRID } from "../lib/layouts";
import { THEMES, type AppTheme } from "../lib/themes";
import { SettingsPanel } from "./SettingsPanel";

function GridPicker({
  current,
  onSelect,
}: {
  current: { rows: number; cols: number };
  onSelect: (rows: number, cols: number) => void | Promise<void>;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  return (
    <div className="p-2">
      <div className="text-[10px] text-[var(--vt-muted-text)] mb-1.5 text-center">
        {hover ? `${hover.r} × ${hover.c}` : "Select grid size"}
      </div>
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${MAX_GRID}, 1fr)` }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: MAX_GRID * MAX_GRID }, (_, i) => {
          const r = Math.floor(i / MAX_GRID) + 1;
          const c = (i % MAX_GRID) + 1;
          const hovered = hover && r <= hover.r && c <= hover.c;
          const active = r <= current.rows && c <= current.cols;
          return (
            <button
              key={i}
              className={`cursor-pointer w-3 h-3 rounded-[2px] border transition-colors ${
                hovered
                  ? "bg-[var(--vt-accent)] border-[var(--vt-accent)]"
                  : active
                    ? "bg-[var(--vt-input-border)] border-[var(--vt-dim-text)]"
                    : "bg-transparent border-[var(--vt-input-border)]"
              }`}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onSelect(r, c)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: AppTheme }) {
  return (
    <div className="flex gap-[2px] shrink-0">
      {[theme.ui.bg, theme.ui.chromeBg, theme.ui.accent, theme.ui.foreground].map(
        (color, i) => (
          <span
            key={i}
            className="w-2.5 h-2.5 rounded-full border border-black/20"
            style={{ background: color }}
          />
        ),
      )}
    </div>
  );
}

function ToolbarButton({
  tooltip,
  active = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      data-tip={tooltip}
      className={`vt-tooltip-trigger cursor-pointer flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors ${
        props.disabled
          ? "opacity-45 text-[var(--vt-dim-text)]"
          : active
            ? "bg-[color-mix(in_srgb,var(--vt-accent)_14%,transparent)] text-[var(--vt-foreground)]"
            : "text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)] hover:bg-[var(--vt-border)]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function TerminalPreview({ theme }: { theme: AppTheme }) {
  const t = theme.terminal;
  return (
    <div
      className="w-[160px] h-[60px] rounded shrink-0 overflow-hidden p-1.5 flex flex-col justify-center gap-[1px] border"
      style={{
        background: t.background,
        borderColor: theme.ui.border,
      }}
    >
      <div className="flex items-center gap-1 leading-none" style={{ fontSize: 8, fontFamily: "monospace" }}>
        <span style={{ color: t.green }}>$</span>
        <span style={{ color: t.foreground }}>ls -la ~/projects</span>
      </div>
      <div className="flex items-center gap-1 leading-none" style={{ fontSize: 8, fontFamily: "monospace" }}>
        <span style={{ color: t.blue }}>src/</span>
        <span style={{ color: t.foreground }}>README.md</span>
        <span style={{ color: t.yellow }}>config.ts</span>
      </div>
      <div className="flex items-center gap-1 leading-none" style={{ fontSize: 8, fontFamily: "monospace" }}>
        <span style={{ color: t.yellow }}>$</span>
        <span
          className="inline-block w-[5px] h-[8px]"
          style={{ background: t.cursor ?? t.foreground }}
        />
      </div>
    </div>
  );
}

function useOutsideClick(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, open, onClose]);
}

export function TopBar() {
  const grid = useStore((s) => s.grid);
  const theme = useStore((s) => s.theme);
  const themePreview = useStore((s) => s.themePreview);
  const customThemes = useStore((s) => s.customThemes);
  const setTheme = useStore((s) => s.setTheme);
  const setThemePreview = useStore((s) => s.setThemePreview);

  const [gridOpen, setGridOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useOutsideClick(gridRef, gridOpen, () => setGridOpen(false));
  useOutsideClick(themeRef, themeOpen, () => setThemeOpen(false));
  useOutsideClick(settingsRef, settingsOpen, () => setSettingsOpen(false));

  useEffect(() => {
    if (!themeOpen && themePreview) {
      setThemePreview(null);
    }
  }, [themeOpen, themePreview, setThemePreview]);
  const availableThemes = [...THEMES, ...customThemes];
  const activeTheme = themePreview ?? theme;
  const isPreviewing = Boolean(themePreview && themePreview.name !== theme.name);

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[var(--vt-chrome-bg)] border-b border-[var(--vt-border)] select-none shrink-0">
      <div className="relative" ref={gridRef}>
        <ToolbarButton
          onClick={() => setGridOpen(!gridOpen)}
          active={gridOpen}
          tooltip="Grid layout"
        >
          <span className="text-sm">⊞</span>
          <span>
            {grid.rows}×{grid.cols}
          </span>
          <span className="text-[10px]">▾</span>
        </ToolbarButton>
        {gridOpen && (
          <div className="absolute top-full left-0 mt-1 bg-[var(--vt-dropdown-bg)] border border-[var(--vt-input-border)] rounded-md shadow-lg z-50">
            <GridPicker
              current={grid}
              onSelect={async (r, c) => {
                const changed = await changeGridWithWarning(r, c);
                if (changed) {
                  setGridOpen(false);
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="relative" ref={themeRef}>
        <ToolbarButton
          onClick={() => setThemeOpen((open) => !open)}
          active={themeOpen || isPreviewing}
          tooltip={isPreviewing ? `Previewing ${activeTheme.name}` : "Theme picker"}
        >
          <ThemeSwatch theme={activeTheme} />
          <span>{activeTheme.name}</span>
          <span className="text-[10px]">▾</span>
        </ToolbarButton>
        {themeOpen && (
          <div
            className="absolute top-full left-0 mt-1 bg-[var(--vt-dropdown-bg)] border border-[var(--vt-input-border)] rounded-xl shadow-lg z-50 min-w-[360px] max-h-[440px] overflow-hidden"
            onMouseLeave={() => setThemePreview(null)}
          >
            <div className="px-3 pt-3 pb-2 border-b border-[var(--vt-border)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium text-[var(--vt-foreground)]">
                    {isPreviewing ? `Previewing ${activeTheme.name}` : `${theme.name} active`}
                  </div>
                  <div className="text-[10px] text-[var(--vt-muted-text)]">
                    Hover to preview. Click to apply.
                  </div>
                </div>
                <ThemeSwatch theme={activeTheme} />
              </div>
            </div>
            <div className="py-2 px-2 overflow-y-auto max-h-[380px] space-y-1">
              {availableThemes.map((t) => (
                <button
                  key={t.name}
                  onMouseEnter={() => setThemePreview(t)}
                  onFocus={() => setThemePreview(t)}
                  onClick={() => {
                    setTheme(t);
                    setThemePreview(null);
                    setThemeOpen(false);
                  }}
                  title="Hover to preview, click to apply"
                  className={`flex items-center gap-3 w-full px-2.5 py-2 rounded-xl border text-xs transition-colors ${
                    t.name === theme.name
                      ? "border-[color-mix(in_srgb,var(--vt-accent)_60%,var(--vt-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] text-[var(--vt-foreground)]"
                      : t.name === themePreview?.name
                        ? "border-[color-mix(in_srgb,var(--vt-accent)_45%,var(--vt-border))] bg-[color-mix(in_srgb,var(--vt-accent)_7%,transparent)] text-[var(--vt-foreground)]"
                        : "border-transparent text-[var(--vt-foreground)] hover:bg-[var(--vt-border)]"
                  }`}
                >
                  <TerminalPreview theme={t} />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      {t.name === theme.name && (
                        <span className="px-1.5 py-[1px] rounded-full text-[9px] uppercase tracking-[0.08em] bg-[color-mix(in_srgb,var(--vt-accent)_16%,transparent)] text-[var(--vt-accent)]">
                          Active
                        </span>
                      )}
                      {t.custom && (
                        <span className="px-1.5 py-[1px] rounded-full text-[9px] uppercase tracking-[0.08em] bg-[color-mix(in_srgb,var(--vt-foreground)_10%,transparent)] text-[var(--vt-foreground)]">
                          Custom
                        </span>
                      )}
                      {t.name === themePreview?.name && t.name !== theme.name && (
                        <span className="px-1.5 py-[1px] rounded-full text-[9px] uppercase tracking-[0.08em] bg-[color-mix(in_srgb,var(--vt-foreground)_10%,transparent)] text-[var(--vt-foreground)]">
                          Preview
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--vt-muted-text)]">
                      <ThemeSwatch theme={t} />
                      <span>Accent-led pane glow</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={settingsRef}>
        <ToolbarButton
          onClick={() => setSettingsOpen(!settingsOpen)}
          active={settingsOpen}
          tooltip="Settings"
        >
          <span className="text-sm">&#9881;</span>
        </ToolbarButton>
        {settingsOpen && (
          <div className="absolute top-full left-0 mt-1 bg-[var(--vt-dropdown-bg)] border border-[var(--vt-input-border)] rounded-md shadow-lg z-50">
            <SettingsPanel />
          </div>
        )}
      </div>
      <div className="flex-1" />
    </div>
  );
}
