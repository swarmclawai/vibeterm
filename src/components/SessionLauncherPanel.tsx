import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  createSessionInDir,
  getTerminalRuntime,
  hasTerminalRuntime,
  isTauriRuntime,
  listLaunchers,
  listLocalShells,
  listProviderSessions,
  searchDirectories,
  type DirectoryMatch,
  type LaunchRequest,
  type LauncherInfo,
  type LocalShellInfo,
  type ProviderSessionInfo,
  type SessionInfo,
} from "../lib/tauri";

interface SessionLauncherPanelProps {
  defaultCwd?: string;
  onCreated: (info: SessionInfo) => void;
}

const FALLBACK_LAUNCHER: LauncherInfo = {
  id: "shell",
  label: "Shell",
  supportsResume: false,
  localOnly: false,
  available: true,
};

const FAVORITES_STORAGE_KEY = "vibeterm-launcher-favorites";
const RECENTS_STORAGE_KEY = "vibeterm-launcher-recents";
const MAX_SAVED_DIRECTORIES = 10;

function formatUpdatedAt(updatedAt: string): string {
  if (!updatedAt.trim()) return "Recent";
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return updatedAt;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function launcherShortLabel(label: string): string {
  return label.replace(/\s+CLI$/i, "");
}

function pathLabel(inputPath: string): string {
  const normalized = inputPath.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || normalized || "Directory";
}

function normalizeDirectory(entry: Partial<DirectoryMatch> & { path: string }): DirectoryMatch {
  return {
    path: entry.path.trim(),
    label: entry.label?.trim() || pathLabel(entry.path),
    iconPath: entry.iconPath?.trim() || null,
  };
}

function dedupeDirectories(entries: DirectoryMatch[]): DirectoryMatch[] {
  const seen = new Set<string>();
  const next: DirectoryMatch[] = [];
  for (const entry of entries) {
    const normalized = normalizeDirectory(entry);
    if (!normalized.path || seen.has(normalized.path)) continue;
    seen.add(normalized.path);
    next.push(normalized);
  }
  return next;
}

function matchesDirectoryQuery(entry: DirectoryMatch, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = `${entry.label} ${entry.path}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function filterDirectories(entries: DirectoryMatch[], query: string): DirectoryMatch[] {
  return dedupeDirectories(entries).filter((entry) => matchesDirectoryQuery(entry, query));
}

function looksLikeDirectoryPath(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("/")
    || trimmed.startsWith("~")
    || trimmed.startsWith(".")
    || trimmed.includes("/");
}

function readSavedDirectories(key: string): DirectoryMatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeDirectories(
      parsed
        .filter((value): value is DirectoryMatch => Boolean(value && typeof value.path === "string"))
        .map((value) => normalizeDirectory(value)),
    );
  } catch {
    return [];
  }
}

function writeSavedDirectories(key: string, directories: DirectoryMatch[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    key,
    JSON.stringify(dedupeDirectories(directories).slice(0, MAX_SAVED_DIRECTORIES)),
  );
}

function mergeRecentDirectory(entry: DirectoryMatch, existing: DirectoryMatch[]): DirectoryMatch[] {
  return dedupeDirectories([normalizeDirectory(entry), ...existing]).slice(0, MAX_SAVED_DIRECTORIES);
}

function isPathSaved(path: string, entries: DirectoryMatch[]): boolean {
  return entries.some((entry) => entry.path === path);
}

function DirectoryIcon({
  entry,
  size = "lg",
}: {
  entry: DirectoryMatch | null;
  size?: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const iconSrc = useMemo(() => {
    if (!entry?.iconPath || failed || !isTauriRuntime()) return null;
    try {
      return convertFileSrc(entry.iconPath);
    } catch {
      return null;
    }
  }, [entry, failed]);

  const boxClass = size === "lg"
    ? "h-14 w-14 rounded-2xl text-base"
    : "h-8 w-8 rounded-xl text-[10px]";

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        onError={() => setFailed(true)}
        className={`${boxClass} shrink-0 border border-[var(--vt-input-border)] object-cover`}
      />
    );
  }

  const initials = (entry?.label || "Dir")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase() || "DI";

  return (
    <div className={`${boxClass} shrink-0 flex items-center justify-center border border-[color-mix(in_srgb,var(--vt-accent)_24%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--vt-accent)_18%,transparent),color-mix(in_srgb,var(--vt-border)_80%,transparent))] font-semibold tracking-[0.12em] text-[var(--vt-foreground)]`}>
      {initials}
    </div>
  );
}

/* ── Step indicator ── */

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-200 ${
            i < step
              ? "w-4 bg-[var(--vt-accent)]"
              : i === step
                ? "w-4 bg-[var(--vt-accent)] opacity-50"
                : "w-1 bg-[var(--vt-muted-text)] opacity-30"
          }`}
        />
      ))}
    </div>
  );
}

/* ── Launcher option button ── */

function LauncherOption({
  launcher,
  active,
  onSelect,
}: {
  launcher: LauncherInfo;
  active: boolean;
  onSelect: () => void;
}) {
  const short = launcherShortLabel(launcher.label);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border px-3 py-2 text-left transition-all ${
        active
          ? "border-[color-mix(in_srgb,var(--vt-accent)_50%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_12%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--vt-accent)_20%,transparent)]"
          : "border-[var(--vt-input-border)] bg-transparent hover:border-[color-mix(in_srgb,var(--vt-accent)_30%,var(--vt-input-border))] hover:bg-[color-mix(in_srgb,var(--vt-bg)_60%,transparent)]"
      }`}
    >
      <div className="text-[12px] font-medium text-[var(--vt-foreground)]">
        {short}
      </div>
      {launcher.supportsResume && (
        <div className="mt-0.5 text-[10px] text-[var(--vt-dim-text)]">
          Supports resume
        </div>
      )}
    </button>
  );
}

/* ── Shell selector button ── */

function ShellOption({
  shell,
  active,
  onSelect,
}: {
  shell: LocalShellInfo;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] transition-all ${
        active
          ? "border-[color-mix(in_srgb,var(--vt-accent)_50%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_12%,transparent)] font-medium text-[var(--vt-foreground)]"
          : "border-[var(--vt-input-border)] text-[var(--vt-muted-text)] hover:border-[color-mix(in_srgb,var(--vt-accent)_30%,var(--vt-input-border))] hover:text-[var(--vt-foreground)]"
      }`}
    >
      {shell.label}
    </button>
  );
}

export function SessionLauncherPanel({
  defaultCwd,
  onCreated,
}: SessionLauncherPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([]);
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [providerSessions, setProviderSessions] = useState<ProviderSessionInfo[]>([]);
  const [launcherId, setLauncherId] = useState("");
  const [shellId, setShellId] = useState("");
  const [resumeMode, setResumeMode] = useState<"new" | "last" | "session">("new");
  const [providerSessionId, setProviderSessionId] = useState("");
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingProviderSessions, setLoadingProviderSessions] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStartedRemoteRef = useRef(false);

  const [favoriteDirectories, setFavoriteDirectories] = useState<DirectoryMatch[]>(
    () => readSavedDirectories(FAVORITES_STORAGE_KEY),
  );
  const [recentDirectories, setRecentDirectories] = useState<DirectoryMatch[]>(
    () => readSavedDirectories(RECENTS_STORAGE_KEY),
  );
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryMatch[]>([]);
  const [searchingDirectories, setSearchingDirectories] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [step, setStep] = useState(0); // 0=directory, 1=launcher, 2=resume, 3=launch

  const runtime = getTerminalRuntime();
  const isRemoteRuntime = runtime === "remote";
  const trimmedDirectoryQuery = directoryQuery.trim();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!hasTerminalRuntime()) {
        setLoading(false);
        setError("No terminal backend configured. Set VITE_VIBETERM_REMOTE_URL or run in Tauri.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (!isTauriRuntime()) {
          if (cancelled) return;
          setLaunchers([FALLBACK_LAUNCHER]);
          setShells([]);
          return;
        }
        const [nextLaunchers, nextShells] = await Promise.all([
          listLaunchers(),
          listLocalShells(),
        ]);
        if (cancelled) return;
        setLaunchers(nextLaunchers.length ? nextLaunchers : [FALLBACK_LAUNCHER]);
        setShells(nextShells);
      } catch (nextError) {
        if (cancelled) return;
        setLaunchers([FALLBACK_LAUNCHER]);
        setShells([]);
        setError(nextError instanceof Error ? nextError.message : "Unable to inspect local launchers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? node.getBoundingClientRect().width;
      setPanelWidth(Math.round(nextWidth));
    });
    observer.observe(node);
    setPanelWidth(Math.round(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!launchers.length) return;
    setLauncherId((current) => {
      if (launchers.some((l) => l.id === current)) return current;
      return launchers[0].id;
    });
  }, [launchers]);

  useEffect(() => {
    if (!shells.length) return;
    const defaultShell = shells.find((s) => s.isDefault) ?? shells[0];
    setShellId((current) => {
      if (shells.some((s) => s.id === current)) return current;
      return defaultShell.id;
    });
  }, [shells]);

  const selectedLauncher = useMemo(
    () => launchers.find((l) => l.id === launcherId) ?? launchers[0] ?? FALLBACK_LAUNCHER,
    [launchers, launcherId],
  );

  const selectedShell = useMemo(
    () => shells.find((s) => s.id === shellId) ?? shells.find((s) => s.isDefault) ?? shells[0] ?? null,
    [shells, shellId],
  );

  const favoritePaths = useMemo(
    () => new Set(favoriteDirectories.map((e) => e.path)),
    [favoriteDirectories],
  );

  const recentPaths = useMemo(
    () => new Set(recentDirectories.map((e) => e.path)),
    [recentDirectories],
  );

  useEffect(() => {
    if (selectedLauncher.supportsResume) return;
    setResumeMode("new");
    setProviderSessionId("");
  }, [selectedLauncher.supportsResume]);

  useEffect(() => {
    if (resumeMode === "session") return;
    setProviderSessionId("");
    setSessionSearchQuery("");
  }, [resumeMode]);

  useEffect(() => {
    if (!isTauriRuntime() || !selectedLauncher.supportsResume || selectedLauncher.id === "shell") {
      setProviderSessions([]);
      setLoadingProviderSessions(false);
      return;
    }
    let cancelled = false;
    setLoadingProviderSessions(true);
    listProviderSessions(selectedLauncher.id, workingDirectory || defaultCwd)
      .then((sessions) => { if (!cancelled) setProviderSessions(sessions); })
      .catch((e) => {
        if (cancelled) return;
        setProviderSessions([]);
        setError(e instanceof Error ? e.message : `Unable to inspect recent ${selectedLauncher.label} sessions.`);
      })
      .finally(() => { if (!cancelled) setLoadingProviderSessions(false); });
    return () => { cancelled = true; };
  }, [defaultCwd, selectedLauncher.id, selectedLauncher.label, selectedLauncher.supportsResume, workingDirectory]);

  useEffect(() => {
    if (resumeMode !== "session" || !providerSessions.length) return;
    setProviderSessionId((current) => {
      if (providerSessions.some((s) => s.id === current)) return current;
      return providerSessions[0].id;
    });
  }, [providerSessions, resumeMode]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setSearchResults([]);
      setSearchingDirectories(false);
      return;
    }
    if (!trimmedDirectoryQuery) {
      setSearchResults([]);
      setSearchingDirectories(false);
      return;
    }
    let cancelled = false;
    setSearchingDirectories(true);
    const timeoutId = window.setTimeout(() => {
      void searchDirectories(trimmedDirectoryQuery, 10)
        .then((results) => { if (!cancelled) setSearchResults(dedupeDirectories(results)); })
        .catch((e) => {
          if (cancelled) return;
          setSearchResults([]);
          setError(e instanceof Error ? e.message : "Unable to search directories.");
        })
        .finally(() => { if (!cancelled) setSearchingDirectories(false); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [trimmedDirectoryQuery]);

  const selectedDirectory = useMemo(() => {
    const path = workingDirectory.trim() || defaultCwd?.trim() || "";
    if (!path) return null;
    return (
      dedupeDirectories([
        ...searchResults,
        ...favoriteDirectories,
        ...recentDirectories,
        { path, label: pathLabel(path) },
      ]).find((e) => e.path === path) ?? null
    );
  }, [defaultCwd, favoriteDirectories, recentDirectories, searchResults, workingDirectory]);

  const selectedDirectoryIsFavorite = Boolean(selectedDirectory && favoritePaths.has(selectedDirectory.path));

  const filteredProviderSessions = useMemo(() => {
    const query = sessionSearchQuery.trim().toLowerCase();
    if (!query) {
      return providerSessions.slice(0, 10);
    }
    return providerSessions
      .filter((session) => {
        const haystack = `${session.label} ${session.id} ${session.updatedAt}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 10);
  }, [providerSessions, sessionSearchQuery]);

  const manualPathCandidate = useMemo(() => {
    if (!looksLikeDirectoryPath(trimmedDirectoryQuery)) return null;
    const candidate = normalizeDirectory({ path: trimmedDirectoryQuery, label: pathLabel(trimmedDirectoryQuery) });
    const alreadyKnown = dedupeDirectories([...favoriteDirectories, ...recentDirectories, ...searchResults])
      .some((e) => e.path === candidate.path);
    return alreadyKnown ? null : candidate;
  }, [favoriteDirectories, recentDirectories, searchResults, trimmedDirectoryQuery]);

  const localSearchMatches = useMemo(() => {
    if (!trimmedDirectoryQuery) return [];
    return filterDirectories([...favoriteDirectories, ...recentDirectories], trimmedDirectoryQuery);
  }, [favoriteDirectories, recentDirectories, trimmedDirectoryQuery]);

  const quickSearchMatches = useMemo(
    () => dedupeDirectories([...(manualPathCandidate ? [manualPathCandidate] : []), ...localSearchMatches]),
    [localSearchMatches, manualPathCandidate],
  );

  const systemSearchResults = useMemo(() => {
    if (!trimmedDirectoryQuery) return [];
    const localPaths = new Set(quickSearchMatches.map((e) => e.path));
    return searchResults.filter((e) => !localPaths.has(e.path));
  }, [quickSearchMatches, searchResults, trimmedDirectoryQuery]);

  const primarySearchCandidate = useMemo(
    () => quickSearchMatches[0] ?? systemSearchResults[0] ?? null,
    [quickSearchMatches, systemSearchResults],
  );

  const canLaunch =
    !loading
    && !spawning
    && hasTerminalRuntime()
    && (resumeMode !== "session" || providerSessionId.trim().length > 0);

  const isMicroPane = panelWidth > 0 && panelWidth < 320;

  const rememberRecentDirectory = useCallback((entry: DirectoryMatch | null) => {
    if (!entry) return;
    setRecentDirectories((current) => {
      const next = mergeRecentDirectory(entry, current);
      writeSavedDirectories(RECENTS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleFavoriteDirectory = useCallback((entry: DirectoryMatch | null) => {
    if (!entry) return;
    setFavoriteDirectories((current) => {
      const next = isPathSaved(entry.path, current)
        ? current.filter((item) => item.path !== entry.path)
        : dedupeDirectories([normalizeDirectory(entry), ...current]).slice(0, MAX_SAVED_DIRECTORIES);
      writeSavedDirectories(FAVORITES_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const selectDirectory = useCallback((entry: DirectoryMatch) => {
    setWorkingDirectory(normalizeDirectory(entry).path);
    setStep(1);
  }, []);

  const selectLauncher = useCallback((id: string) => {
    setLauncherId(id);
    setStep(2);
  }, []);

  const directoryBadgesFor = useCallback((entry: DirectoryMatch) => {
    const badges: string[] = [];
    if (favoritePaths.has(entry.path)) badges.push("Pinned");
    if (recentPaths.has(entry.path)) badges.push("Recent");
    return badges;
  }, [favoritePaths, recentPaths]);

  const launch = useCallback(async () => {
    if (!canLaunch) return;
    setSpawning(true);
    setError(null);
    const launchConfig: LaunchRequest = { launcherId: selectedLauncher.id, resumeMode };
    if (selectedLauncher.id === "shell" && selectedShell) launchConfig.shellId = selectedShell.id;
    if (resumeMode === "session") launchConfig.providerSessionId = providerSessionId.trim();
    const nextDirectory = workingDirectory.trim() || defaultCwd?.trim() || "";
    try {
      const info = nextDirectory
        ? await createSessionInDir("Terminal", nextDirectory, launchConfig)
        : await createSession("Terminal", launchConfig);
      if (nextDirectory) {
        rememberRecentDirectory(selectedDirectory ?? { path: nextDirectory, label: pathLabel(nextDirectory) });
      }
      onCreated(info);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to start the requested terminal session.");
    } finally {
      setSpawning(false);
    }
  }, [canLaunch, defaultCwd, onCreated, providerSessionId, rememberRecentDirectory, resumeMode, selectedDirectory, selectedLauncher.id, selectedShell, workingDirectory]);

  useEffect(() => {
    if (!isRemoteRuntime || loading || spawning || autoStartedRemoteRef.current) return;
    autoStartedRemoteRef.current = true;
    void launch();
  }, [isRemoteRuntime, launch, loading, spawning]);

  // Remote runtime — auto-start shell
  if (isRemoteRuntime) {
    return (
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--vt-border-radius)] border border-[var(--vt-border)] bg-[var(--vt-bg)]">
        <div className="flex flex-1 min-h-0 items-center justify-center p-5">
          <div className="w-full max-w-[360px] text-center">
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--vt-dim-text)]">
              Remote Runtime
            </div>
            <div className="mt-2 text-[16px] font-semibold text-[var(--vt-foreground)]">
              {spawning ? "Connecting..." : error ? "Connection failed" : "Starting shell..."}
            </div>
            {error && (
              <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--vt-accent)_30%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--vt-foreground)]">
                {error}
              </div>
            )}
            {error && (
              <button
                type="button"
                onClick={() => void launch()}
                disabled={!canLaunch}
                className="mt-3 rounded-xl bg-[var(--vt-accent)] px-5 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-45"
              >
                Retry
              </button>
            )}
            {!error && (
              <div className="mt-4 flex justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--vt-accent)_18%,transparent)] border-t-[var(--vt-accent)]" />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Micro pane — minimal launch button
  if (isMicroPane) {
    return (
      <div ref={panelRef} className="flex h-full w-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[var(--vt-border-radius)] border border-[var(--vt-border)] bg-[var(--vt-bg)]">
        <div className="grid w-full max-w-[240px] gap-3 px-4">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--vt-dim-text)]">
              New Terminal
            </div>
            <div className="mt-1 truncate text-[12px] text-[var(--vt-muted-text)]">
              {workingDirectory || defaultCwd
                ? pathLabel(workingDirectory || defaultCwd || "")
                : launcherShortLabel(selectedLauncher.label)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void launch()}
            disabled={!canLaunch}
            className="w-full cursor-pointer rounded-xl bg-[var(--vt-accent)] px-4 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {spawning ? "Starting..." : "Launch"}
          </button>
          {error && (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--vt-accent)_35%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--vt-foreground)]">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Directory list for step 0 ──

  const allDirectoryEntries = (() => {
    if (trimmedDirectoryQuery) {
      return dedupeDirectories([...quickSearchMatches, ...systemSearchResults]).slice(0, 8);
    }
    return dedupeDirectories([...favoriteDirectories, ...recentDirectories]).slice(0, 8);
  })();

  // ── 3-step layout ──

  return (
    <div ref={panelRef} className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--vt-border-radius)] border border-[var(--vt-border)] bg-[var(--vt-bg)]">

      {/* Step bar */}
      <div className="flex items-center gap-3 border-b border-[var(--vt-input-border)] bg-[var(--vt-chrome-bg)] px-3 py-2">
        <StepIndicator step={step} total={4} />
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] text-[var(--vt-muted-text)] transition-colors hover:text-[var(--vt-foreground)]"
            >
              Back
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] text-[var(--vt-muted-text)] transition-colors hover:text-[var(--vt-foreground)]"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">

        {/* ─── Step 0: Select Directory ─── */}
        {step === 0 && (
          <div className="p-3">
            <div className="mb-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--vt-dim-text)]">
                Step 1 &middot; Choose directory
              </div>
              <div className="mt-1 text-[11px] text-[var(--vt-muted-text)]">
                Pick a project folder or skip to use the default.
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[11px] text-[var(--vt-dim-text)]">
                &#x2315;
              </span>
              <input
                value={directoryQuery}
                onChange={(e) => setDirectoryQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (primarySearchCandidate) selectDirectory(primarySearchCandidate);
                    else setStep(1);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDirectoryQuery("");
                  }
                }}
                className="w-full rounded-lg border border-[var(--vt-input-border)] bg-[var(--vt-bg)] py-1.5 pl-7 pr-3 text-[12px] text-[var(--vt-foreground)] outline-none transition-colors focus:border-[var(--vt-accent)]"
                placeholder="Search project or paste path..."
              />
            </div>

            {/* Selected directory badge */}
            {selectedDirectory && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--vt-accent)_28%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_6%,transparent)] px-2.5 py-2">
                <DirectoryIcon entry={selectedDirectory} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[var(--vt-foreground)]">{selectedDirectory.label}</div>
                  <div className="truncate text-[10px] text-[var(--vt-muted-text)]">{selectedDirectory.path}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFavoriteDirectory(selectedDirectory)}
                  className={`shrink-0 cursor-pointer rounded-md border px-2 py-0.5 text-[10px] transition-colors ${
                    selectedDirectoryIsFavorite
                      ? "border-[color-mix(in_srgb,var(--vt-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] text-[var(--vt-foreground)]"
                      : "border-[var(--vt-input-border)] text-[var(--vt-dim-text)] hover:text-[var(--vt-foreground)]"
                  }`}
                >
                  {selectedDirectoryIsFavorite ? "Pinned" : "Pin"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="shrink-0 cursor-pointer rounded-md bg-[var(--vt-accent)] px-2.5 py-1 text-[10px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  Next
                </button>
              </div>
            )}

            {/* Pinned directories */}
            {!trimmedDirectoryQuery && favoriteDirectories.length > 0 && (
              <div className="mb-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--vt-dim-text)]">
                  Pinned
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {favoriteDirectories.map((entry) => (
                    <button
                      key={`fav-${entry.path}`}
                      type="button"
                      onClick={() => selectDirectory(entry)}
                      className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                        selectedDirectory?.path === entry.path
                          ? "border-[color-mix(in_srgb,var(--vt-accent)_40%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] text-[var(--vt-foreground)]"
                          : "border-[var(--vt-input-border)] text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)]"
                      }`}
                    >
                      <DirectoryIcon entry={entry} size="sm" />
                      <span className="truncate">{entry.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Directory list */}
            {allDirectoryEntries.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--vt-dim-text)]">
                  {trimmedDirectoryQuery
                    ? searchingDirectories ? "Searching..." : `${allDirectoryEntries.length} results`
                    : "Recent"}
                </div>
                <div className="grid gap-0.5">
                  {allDirectoryEntries.map((entry) => (
                    <button
                      key={`dir-${entry.path}`}
                      type="button"
                      onClick={() => selectDirectory(entry)}
                      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                        selectedDirectory?.path === entry.path
                          ? "border-[color-mix(in_srgb,var(--vt-accent)_40%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)]"
                          : "border-transparent hover:border-[var(--vt-input-border)] hover:bg-[color-mix(in_srgb,var(--vt-bg)_56%,transparent)]"
                      }`}
                    >
                      <DirectoryIcon entry={entry} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-[var(--vt-foreground)]">{entry.label}</span>
                          {directoryBadgesFor(entry).slice(0, 2).map((badge) => (
                            <span
                              key={`${entry.path}-${badge}`}
                              className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--vt-accent)_24%,transparent)] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--vt-dim-text)]"
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                        <div className="truncate text-[10px] text-[var(--vt-muted-text)]">{entry.path}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!trimmedDirectoryQuery && !favoriteDirectories.length && !recentDirectories.length && !selectedDirectory && (
              <div className="px-2 py-8 text-center text-[12px] text-[var(--vt-muted-text)]">
                Search for a project or paste a path to get started.
              </div>
            )}
          </div>
        )}

        {/* ─── Step 1: Select Launcher ─── */}
        {step === 1 && (
          <div className="p-3">
            <div className="mb-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--vt-dim-text)]">
                Step 2 &middot; Choose launcher
              </div>
              <div className="mt-1 text-[11px] text-[var(--vt-muted-text)]">
                {selectedDirectory
                  ? <>Launching in <span className="text-[var(--vt-foreground)]">{selectedDirectory.label}</span></>
                  : "Select a shell or CLI tool to launch."}
              </div>
            </div>

            {/* Launcher grid */}
            <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {launchers.map((launcher) => (
                <LauncherOption
                  key={launcher.id}
                  launcher={launcher}
                  active={launcherId === launcher.id}
                  onSelect={() => selectLauncher(launcher.id)}
                />
              ))}
            </div>

            {/* Shell selector (when Shell is selected) */}
            {selectedLauncher.id === "shell" && shells.length > 1 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--vt-dim-text)]">
                  Shell
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {shells.map((shell) => (
                    <ShellOption
                      key={shell.id}
                      shell={shell}
                      active={shellId === shell.id}
                      onSelect={() => setShellId(shell.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_88%,black_12%)] p-2.5 text-[11px] text-[var(--vt-muted-text)]">
              {selectedLauncher.supportsResume
                ? "Next, choose whether this launcher should start new, resume latest, or resume a specific session."
                : "This launcher starts a fresh local session and does not expose provider-side resume options."}
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="cursor-pointer rounded-md bg-[var(--vt-accent)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Resume ─── */}
        {step === 2 && (
          <div className="p-3">
            <div className="mb-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--vt-dim-text)]">
                Step 3 &middot; Session mode
              </div>
              <div className="mt-1 text-[11px] text-[var(--vt-muted-text)]">
                {selectedLauncher.supportsResume
                  ? `Choose whether ${launcherShortLabel(selectedLauncher.label)} starts fresh or resumes an earlier session.`
                  : "This launcher always starts a fresh local session."}
              </div>
            </div>

            {selectedLauncher.supportsResume ? (
              <div className="rounded-xl border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_88%,black_12%)] p-2.5">
                <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--vt-dim-text)]">
                  Resume
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {(["new", "last", "session"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setResumeMode(mode)}
                      className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] transition-all ${
                        resumeMode === mode
                          ? "border-[color-mix(in_srgb,var(--vt-accent)_50%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_12%,transparent)] font-medium text-[var(--vt-foreground)]"
                          : "border-[var(--vt-input-border)] text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)]"
                      }`}
                    >
                      {mode === "new" ? "New session" : mode === "last" ? "Resume latest" : "Choose session"}
                    </button>
                  ))}
                </div>

                {resumeMode === "session" && (
                  <div className="grid gap-2">
                    <input
                      value={sessionSearchQuery}
                      onChange={(e) => setSessionSearchQuery(e.target.value)}
                      placeholder="Search recent sessions"
                      disabled={loading || spawning || loadingProviderSessions}
                      className="w-full rounded-lg border border-[var(--vt-input-border)] bg-[var(--vt-bg)] px-3 py-1.5 text-[12px] text-[var(--vt-foreground)] outline-none transition-colors focus:border-[var(--vt-accent)]"
                    />
                    <div className="grid max-h-[180px] gap-1 overflow-y-auto rounded-lg border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-bg)_72%,transparent)] p-1 overscroll-contain">
                      {loadingProviderSessions ? (
                        <div className="px-3 py-2 text-[11px] text-[var(--vt-muted-text)]">
                          Loading recent sessions...
                        </div>
                      ) : filteredProviderSessions.length ? (
                        filteredProviderSessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => setProviderSessionId(session.id)}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                              providerSessionId === session.id
                                ? "border-[color-mix(in_srgb,var(--vt-accent)_40%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_10%,transparent)]"
                                : "border-transparent hover:border-[var(--vt-input-border)] hover:bg-[color-mix(in_srgb,var(--vt-bg)_56%,transparent)]"
                            }`}
                          >
                            <div className="truncate text-[12px] font-medium text-[var(--vt-foreground)]">
                              {session.label}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--vt-muted-text)]">
                              <span className="truncate">{session.id}</span>
                              <span className="opacity-50">•</span>
                              <span>{formatUpdatedAt(session.updatedAt)}</span>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-[11px] text-[var(--vt-muted-text)]">
                          No recent sessions match that search.
                        </div>
                      )}
                    </div>
                    <input
                      value={providerSessionId}
                      onChange={(e) => setProviderSessionId(e.target.value)}
                      placeholder="Or paste a session ID"
                      disabled={loading || spawning}
                      className="w-full rounded-lg border border-[var(--vt-input-border)] bg-[var(--vt-bg)] px-3 py-1.5 text-[12px] text-[var(--vt-foreground)] outline-none transition-colors focus:border-[var(--vt-accent)]"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_88%,black_12%)] p-2.5 text-[11px] text-[var(--vt-muted-text)]">
                Resume is not available for this launcher.
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="cursor-pointer rounded-md bg-[var(--vt-accent)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Review
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Review & Launch ─── */}
        {step === 3 && (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-4">
            <div className="w-full max-w-[360px]">
              <div className="mb-4 text-center">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--vt-dim-text)]">
                  Step 4 &middot; Launch
                </div>
              </div>

              {/* Summary card */}
              <div className="mb-4 rounded-xl border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_88%,black_12%)] p-3">
                {/* Directory row */}
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--vt-bg)_60%,transparent)]"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--vt-input-border)] text-[10px] text-[var(--vt-dim-text)]">
                    1
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-[var(--vt-dim-text)]">Directory</div>
                    <div className="truncate text-[12px] text-[var(--vt-foreground)]">
                      {selectedDirectory ? selectedDirectory.label : "Default"}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--vt-dim-text)]">Edit</span>
                </button>

                <div className="my-1 border-t border-[var(--vt-input-border)]" />

                {/* Launcher row */}
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--vt-bg)_60%,transparent)]"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--vt-input-border)] text-[10px] text-[var(--vt-dim-text)]">
                    2
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-[var(--vt-dim-text)]">Launcher</div>
                    <div className="truncate text-[12px] text-[var(--vt-foreground)]">
                      {launcherShortLabel(selectedLauncher.label)}
                      {selectedLauncher.id === "shell" && selectedShell ? ` (${selectedShell.label})` : ""}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--vt-dim-text)]">Edit</span>
                </button>

                <div className="my-1 border-t border-[var(--vt-input-border)]" />

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--vt-bg)_60%,transparent)]"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--vt-input-border)] text-[10px] text-[var(--vt-dim-text)]">
                    3
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-[var(--vt-dim-text)]">Resume</div>
                    <div className="truncate text-[12px] text-[var(--vt-foreground)]">
                      {!selectedLauncher.supportsResume
                        ? "New session"
                        : resumeMode === "new"
                          ? "Start new session"
                          : resumeMode === "last"
                            ? "Resume latest session"
                            : providerSessionId || "Specific session"}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--vt-dim-text)]">Edit</span>
                </button>
              </div>

              {/* Launch button */}
              <button
                type="button"
                onClick={() => void launch()}
                disabled={!canLaunch}
                className="w-full cursor-pointer rounded-xl bg-[var(--vt-accent)] px-4 py-3 text-[13px] font-medium text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--vt-accent)_28%,transparent)] transition-all hover:shadow-[0_12px_32px_color-mix(in_srgb,var(--vt-accent)_36%,transparent)] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {spawning
                  ? "Starting..."
                  : selectedLauncher.id === "shell"
                    ? "Start Shell"
                    : `Start ${launcherShortLabel(selectedLauncher.label)}`}
              </button>

              {/* Error */}
              {error && (
                <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--vt-accent)_30%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-accent)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--vt-foreground)]">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
