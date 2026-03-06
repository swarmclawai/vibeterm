const CELLS = Array.from({ length: 9 }, (_, index) => index);

interface AppSplashProps {
  visible: boolean;
}

export function AppSplash({ visible }: AppSplashProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_srgb,var(--vt-bg)_90%,black_10%)] backdrop-blur-sm">
      <div className="w-[min(420px,calc(100vw-32px))] rounded-[28px] border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-dropdown-bg)_90%,black_10%)] px-6 py-7 shadow-[0_30px_80px_rgba(0,0,0,0.34)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-3 w-3 rounded-full bg-[var(--vt-accent)] shadow-[0_0_18px_color-mix(in_srgb,var(--vt-accent)_45%,transparent)] animate-pulse" />
          <div>
            <div className="text-sm font-semibold text-[var(--vt-foreground)]">
              VibeTerm 2
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--vt-muted-text)]">
              Warming the workspace.
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
          {CELLS.map((cell) => (
            <span
              key={cell}
              className="h-10 rounded-2xl border border-[color-mix(in_srgb,var(--vt-accent)_18%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--vt-foreground)_10%,transparent)] animate-pulse"
              style={{ animationDelay: `${cell * 70}ms` }}
            />
          ))}
        </div>

        <div className="mt-5 text-[11px] text-[var(--vt-dim-text)]">
          Preparing panes, themes, and companion tools.
        </div>
      </div>
    </div>
  );
}
