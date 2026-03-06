import { useStore } from "../store";
import type { AppSettings } from "../store";
import type { AppTheme } from "../lib/themes";

const FONT_FAMILIES = [
  { label: "SF Mono", value: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace" },
  { label: "Fira Code", value: "'Fira Code', 'SF Mono', Menlo, Consolas, monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace" },
  { label: "Cascadia Code", value: "'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace" },
  { label: "Menlo", value: "Menlo, 'SF Mono', Consolas, monospace" },
  { label: "Consolas", value: "Consolas, Menlo, monospace" },
  { label: "Monaco", value: "Monaco, Menlo, Consolas, monospace" },
];

const CURSOR_STYLES: AppSettings["cursorStyle"][] = ["block", "underline", "bar"];

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-[var(--vt-muted-text)] shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 h-1 accent-[var(--vt-accent)] cursor-pointer"
        />
        <span className="text-[10px] text-[var(--vt-dim-text)] w-8 text-right tabular-nums">
          {value}{suffix ?? ""}
        </span>
      </div>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-[11px] text-[var(--vt-muted-text)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-7 h-4 rounded-full transition-colors ${
          checked ? "bg-[var(--vt-accent)]" : "bg-[var(--vt-input-border)]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </button>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-[var(--vt-muted-text)]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-[var(--vt-input-border)] bg-transparent p-0.5"
        />
        <span className="w-[68px] text-right font-mono text-[10px] text-[var(--vt-dim-text)]">
          {value.toUpperCase()}
        </span>
      </div>
    </label>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const theme = useStore((s) => s.theme);
  const update = useStore((s) => s.updateSettings);
  const customThemes = useStore((s) => s.customThemes);
  const saveCustomTheme = useStore((s) => s.saveCustomTheme);
  const deleteCustomTheme = useStore((s) => s.deleteCustomTheme);

  const customThemeCount = customThemes.length;
  const activeCustomTheme = theme.custom ? theme : null;

  const createCustomTheme = () => {
    const existingNames = new Set(customThemes.map((entry) => entry.name));
    let index = customThemeCount + 1;
    let name = `${theme.name} Custom ${index}`;
    while (existingNames.has(name)) {
      index += 1;
      name = `${theme.name} Custom ${index}`;
    }
    saveCustomTheme({
      ...theme,
      name,
      custom: true,
      terminal: { ...theme.terminal },
      ui: { ...theme.ui },
    });
  };

  const updateCustomTheme = (mutator: (theme: AppTheme) => AppTheme) => {
    if (!activeCustomTheme) return;
    saveCustomTheme(mutator({
      ...activeCustomTheme,
      terminal: { ...activeCustomTheme.terminal },
      ui: { ...activeCustomTheme.ui },
      custom: true,
    }));
  };

  return (
    <div className="w-[260px] p-3 flex flex-col gap-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--vt-dim-text)] font-medium">
        Layout
      </div>
      <div className="flex flex-col gap-2">
        <Slider label="Gap" value={settings.gap} min={0} max={12} suffix="px" onChange={(v) => update({ gap: v })} />
        <Slider label="Border radius" value={settings.borderRadius} min={0} max={16} suffix="px" onChange={(v) => update({ borderRadius: v })} />
      </div>

      <div className="border-t border-[var(--vt-input-border)]" />

      <div className="text-[10px] uppercase tracking-wider text-[var(--vt-dim-text)] font-medium">
        Glow
      </div>
      <div className="flex flex-col gap-2">
        <Toggle label="Enabled" checked={settings.glowEnabled} onChange={(v) => update({ glowEnabled: v })} />
        {settings.glowEnabled && (
          <>
            <Slider label="Intensity" value={settings.glowIntensity} min={0.5} max={2} step={0.1} suffix="x" onChange={(v) => update({ glowIntensity: v })} />
            <Slider label="Width" value={settings.glowWidth} min={1} max={10} suffix="px" onChange={(v) => update({ glowWidth: v })} />
          </>
        )}
      </div>

      <div className="border-t border-[var(--vt-input-border)]" />

      <div className="text-[10px] uppercase tracking-wider text-[var(--vt-dim-text)] font-medium">
        Theme
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-[var(--vt-input-border)] bg-[var(--vt-chrome-bg)] px-3 py-2">
          <div className="text-[11px] text-[var(--vt-foreground)]">
            {theme.name}
          </div>
          <div className="mt-1 text-[10px] leading-4 text-[var(--vt-muted-text)]">
            {activeCustomTheme
              ? "Editing a local custom theme. Changes are saved immediately."
              : "Create a custom copy of the active theme, then tune its colors here."}
          </div>
        </div>

        {!activeCustomTheme ? (
          <button
            type="button"
            onClick={createCustomTheme}
            className="rounded-lg border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--vt-foreground)] transition-colors hover:border-[color-mix(in_srgb,var(--vt-accent)_35%,var(--vt-input-border))]"
          >
            Create custom theme
          </button>
        ) : (
          <>
            <ColorField
              label="Accent"
              value={activeCustomTheme.ui.accent}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                ui: { ...current.ui, accent: value, separatorActive: value },
              }))}
            />
            <ColorField
              label="Background"
              value={activeCustomTheme.ui.bg}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                terminal: { ...current.terminal, background: value },
                ui: { ...current.ui, bg: value },
              }))}
            />
            <ColorField
              label="Chrome"
              value={activeCustomTheme.ui.chromeBg}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                ui: { ...current.ui, chromeBg: value, dropdownBg: value },
              }))}
            />
            <ColorField
              label="Foreground"
              value={activeCustomTheme.ui.foreground}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                terminal: {
                  ...current.terminal,
                  foreground: value,
                  cursor: current.terminal.cursor ?? value,
                },
                ui: { ...current.ui, foreground: value },
              }))}
            />
            <ColorField
              label="Glow Blue"
              value={activeCustomTheme.terminal.blue ?? activeCustomTheme.ui.accent}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                terminal: { ...current.terminal, blue: value },
              }))}
            />
            <ColorField
              label="Glow Magenta"
              value={activeCustomTheme.terminal.magenta ?? activeCustomTheme.ui.accent}
              onChange={(value) => updateCustomTheme((current) => ({
                ...current,
                terminal: { ...current.terminal, magenta: value },
              }))}
            />
            <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--vt-dim-text)]">
              <span>{customThemeCount} custom theme{customThemeCount === 1 ? "" : "s"} saved locally</span>
              <button
                type="button"
                onClick={() => deleteCustomTheme(activeCustomTheme.name)}
                className="rounded border border-[var(--vt-input-border)] px-2 py-1 text-[10px] text-[var(--vt-muted-text)] transition-colors hover:text-red-400"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-[var(--vt-input-border)]" />

      <div className="text-[10px] uppercase tracking-wider text-[var(--vt-dim-text)] font-medium">
        Terminal
      </div>
      <div className="flex flex-col gap-2">
        <Slider label="Font size" value={settings.fontSize} min={10} max={24} suffix="px" onChange={(v) => update({ fontSize: v })} />

        <label className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--vt-muted-text)] shrink-0">Font</span>
          <select
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="text-[11px] bg-[var(--vt-chrome-bg)] text-[var(--vt-foreground)] border border-[var(--vt-input-border)] rounded px-1.5 py-0.5 outline-none cursor-pointer max-w-[140px]"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--vt-muted-text)]">Cursor</span>
          <div className="flex rounded overflow-hidden border border-[var(--vt-input-border)]">
            {CURSOR_STYLES.map((style) => (
              <button
                key={style}
                onClick={() => update({ cursorStyle: style })}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  settings.cursorStyle === style
                    ? "bg-[var(--vt-accent)] text-white"
                    : "bg-[var(--vt-chrome-bg)] text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)]"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--vt-muted-text)] shrink-0">Scrollback</span>
          <input
            type="number"
            min={100}
            max={10000}
            step={100}
            value={settings.scrollback}
            onChange={(e) => {
              const v = Math.max(100, Math.min(10000, Number(e.target.value)));
              update({ scrollback: v });
            }}
            className="w-20 text-[11px] text-right bg-[var(--vt-chrome-bg)] text-[var(--vt-foreground)] border border-[var(--vt-input-border)] rounded px-1.5 py-0.5 outline-none tabular-nums"
          />
        </label>
      </div>
    </div>
  );
}
