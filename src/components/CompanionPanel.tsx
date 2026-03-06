import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview as TauriWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { isTauriRuntime } from "../lib/tauri";
import {
  companionLabelForUrl,
  normalizeCompanionUrl,
} from "../lib/companion";
import { useStore } from "../store";

interface CompanionPanelProps {
  floating?: boolean;
  onStartDrag?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onStartResize?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const COMPANION_BROWSER_LABEL_PREFIX = "companion-browser";
const DEFAULT_COMPANION_BROWSER_URL = "https://www.google.com";
const QUICK_LINKS = [
  { label: "Search", url: "https://www.google.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "Docs", url: "https://developer.mozilla.org" },
  { label: "ChatGPT", url: "https://chatgpt.com" },
];

function createCompanionBrowserLabel(): string {
  return `${COMPANION_BROWSER_LABEL_PREFIX}-${Date.now()}`;
}

async function closeCompanionBrowserWebview(existing?: TauriWebview | null) {
  const targets = existing
    ? [existing]
    : (await TauriWebview.getAll().catch(() => []))
        .filter((webview) => webview.label.startsWith(COMPANION_BROWSER_LABEL_PREFIX));

  await Promise.all(targets.map(async (target) => {
    await target.hide().catch(() => {});
    await target.close().catch(() => {});
  }));
}

function CompanionToolbarButton({
  label,
  active = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      {...props}
      data-tip={label}
      title={label}
      className={`vt-tooltip-trigger cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-[color-mix(in_srgb,var(--vt-accent)_26%,transparent)] bg-[color-mix(in_srgb,var(--vt-accent)_12%,transparent)] text-[var(--vt-foreground)]"
          : "border-[var(--vt-input-border)] text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function CompanionBrowserSurface({
  url,
  onError,
}: {
  url: string;
  onError: (message: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<TauriWebview | null>(null);
  const activeUrlRef = useRef("");
  const syncFrameRef = useRef<number | null>(null);
  const failedUrlRef = useRef("");
  const [isLoading, setIsLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(
    isTauriRuntime() ? null : "Companion browser is available only in the desktop app.",
  );

  const clearScheduledSync = useCallback(() => {
    if (syncFrameRef.current !== null) {
      window.cancelAnimationFrame(syncFrameRef.current);
      syncFrameRef.current = null;
    }
  }, []);

  const reportError = useCallback((message: string) => {
    failedUrlRef.current = url;
    setInlineError(message);
    onError(message);
  }, [onError, url]);

  const clearError = useCallback(() => {
    failedUrlRef.current = "";
    setInlineError(null);
    onError(null);
  }, [onError]);

  const closeNativeWebview = useCallback(async () => {
    clearScheduledSync();
    setIsLoading(false);
    const existing = webviewRef.current;
    webviewRef.current = null;
    activeUrlRef.current = "";
    await closeCompanionBrowserWebview(existing);
  }, [clearScheduledSync]);

  const measureBounds = useCallback(async () => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const insetLeft = 0;
    const insetRight = 0;
    const insetTop = 0;
    const insetBottom = 0;
    const width = Math.max(1, Math.round(rect.width - insetLeft - insetRight));
    const height = Math.max(1, Math.round(rect.height - insetTop - insetBottom));
    if (width < 24 || height < 24) {
      return null;
    }

    let decorationOffsetX = 0;
    let decorationOffsetY = 0;
    if (isTauriRuntime()) {
      try {
        const appWindow = getCurrentWindow();
        const [scaleFactor, innerPosition, outerPosition] = await Promise.all([
          appWindow.scaleFactor(),
          appWindow.innerPosition(),
          appWindow.outerPosition(),
        ]);
        decorationOffsetX = Math.round((innerPosition.x - outerPosition.x) / scaleFactor);
        decorationOffsetY = Math.round((innerPosition.y - outerPosition.y) / scaleFactor);
      } catch {
        decorationOffsetX = 0;
        decorationOffsetY = 0;
      }
    }

    return {
      x: Math.round(rect.left + insetLeft + decorationOffsetX),
      y: Math.round(rect.top + insetTop + decorationOffsetY),
      width,
      height,
    };
  }, []);

  const createOrSyncWebview = useCallback(async () => {
    if (!isTauriRuntime()) {
      reportError("Companion browser is available only in the desktop app.");
      return;
    }

    if (!url.trim()) {
      clearError();
      await closeNativeWebview();
      return;
    }

    if (failedUrlRef.current === url && !webviewRef.current) {
      return;
    }

    const bounds = await measureBounds();
    if (!bounds) return;

    try {
      setIsLoading(true);
      let webview = webviewRef.current;
      const needsRecreate = !webview || activeUrlRef.current !== url;

      if (needsRecreate) {
        await closeNativeWebview();
        await closeCompanionBrowserWebview();

        const nextLabel = createCompanionBrowserLabel();
        webview = new TauriWebview(getCurrentWindow(), nextLabel, {
          url,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          focus: false,
          acceptFirstMouse: true,
          zoomHotkeysEnabled: true,
        });

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve();
          }, 1000);

          webview!.once("tauri://created", () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve();
          }).catch(() => {});

          webview!.once<string>("tauri://error", (event) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            reject(
              new Error(
                String(event.payload ?? "Failed to create the native companion browser."),
              ),
            );
          }).catch(() => {});
        });

        await webview.setAutoResize(false).catch(() => {});
        await webview.setPosition(new LogicalPosition(bounds.x, bounds.y)).catch(() => {});
        await webview.setSize(new LogicalSize(bounds.width, bounds.height)).catch(() => {});
        webviewRef.current = webview;
        activeUrlRef.current = url;
      }

      if (!webview) {
        throw new Error("Native companion browser did not initialize.");
      }

      await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
      await webview.setSize(new LogicalSize(bounds.width, bounds.height));
      await webview.show().catch(() => {});
      await webview.setFocus().catch(() => {});
      clearError();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Failed to create the native companion browser.";
      await closeNativeWebview();
      reportError(message);
    } finally {
      setIsLoading(false);
    }
  }, [clearError, closeNativeWebview, measureBounds, reportError, url]);

  const queueSync = useCallback(() => {
    clearScheduledSync();
    // Double-rAF: wait two frames so CSS grid layout fully settles
    // before measuring bounds for the native webview overlay
    syncFrameRef.current = window.requestAnimationFrame(() => {
      syncFrameRef.current = window.requestAnimationFrame(() => {
        syncFrameRef.current = null;
        void createOrSyncWebview();
      });
    });
  }, [clearScheduledSync, createOrSyncWebview]);

  useEffect(() => {
    queueSync();
    return () => {
      clearScheduledSync();
    };
  }, [clearScheduledSync, queueSync]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const handleResize = () => queueSync();
    const observer = new ResizeObserver(() => queueSync());
    if (hostRef.current) {
      observer.observe(hostRef.current);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [queueSync]);

  useEffect(() => {
    return () => {
      void closeNativeWebview();
    };
  }, [closeNativeWebview]);

  return (
    <div className="relative h-full w-full bg-[var(--vt-bg)]">
      <div
        ref={hostRef}
        className="absolute bottom-3 left-3 right-3 top-8 overflow-hidden rounded-[14px] bg-[var(--vt-bg)]"
        onMouseDown={() => {
          void webviewRef.current?.setFocus().catch(() => {});
        }}
      >
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[color-mix(in_srgb,var(--vt-bg)_88%,transparent)]">
            <div className="rounded-full border border-[color-mix(in_srgb,var(--vt-accent)_24%,transparent)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_92%,black_8%)] px-3 py-1 text-[11px] text-[var(--vt-muted-text)] shadow-[0_16px_36px_rgba(0,0,0,0.24)]">
              Opening native browser...
            </div>
          </div>
        )}
        {inlineError && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div className="max-w-[34ch] rounded-2xl border border-[color-mix(in_srgb,var(--vt-accent)_24%,var(--vt-input-border))] bg-[color-mix(in_srgb,var(--vt-dropdown-bg)_92%,black_8%)] px-4 py-4 text-[12px] leading-5 text-[var(--vt-muted-text)] shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
              {inlineError}
            </div>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-0 z-[2] rounded-[14px]"
          style={{
            boxShadow: "inset 0 0 0 1px var(--vt-input-border)",
          }}
        />
      </div>
    </div>
  );
}

export function CompanionPanel({
  floating = false,
  onStartDrag,
  onStartResize,
}: CompanionPanelProps) {
  const companion = useStore((state) => state.companion);
  const setCompanionState = useStore((state) => state.setCompanionState);
  const closeCompanion = useStore((state) => state.closeCompanion);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [chromeCollapsed, setChromeCollapsed] = useState(false);
  const handleBrowserError = useCallback((message: string | null) => {
    setCompanionState({ status: message ?? null });
  }, [setCompanionState]);

  useEffect(() => {
    setUrlDraft(companion.currentUrl || DEFAULT_COMPANION_BROWSER_URL);
  }, [companion.currentUrl]);

  useEffect(() => {
    if (!companion.open) return;
    addressRef.current?.focus();
  }, [companion.open]);

  useEffect(() => {
    if (!companion.open || !isTauriRuntime()) return;
    if (companion.currentUrl.trim()) return;

    setCompanionState({
      currentUrl: DEFAULT_COMPANION_BROWSER_URL,
      currentEmbedUrl: "",
      contentLabel: companionLabelForUrl(DEFAULT_COMPANION_BROWSER_URL),
      status: null,
    });
  }, [companion.currentUrl, companion.open, setCompanionState]);

  const openBrowser = useCallback((candidateUrl?: string) => {
    const normalized = normalizeCompanionUrl(candidateUrl ?? urlDraft) || DEFAULT_COMPANION_BROWSER_URL;
    setUrlDraft(normalized);
    setCompanionState({
      open: true,
      launchedAppId: "",
      currentUrl: normalized,
      currentEmbedUrl: "",
      contentLabel: companionLabelForUrl(normalized),
      status: null,
    });
  }, [setCompanionState, urlDraft]);

  const handleCloseCompanion = useCallback(() => {
    setCompanionState({
      currentUrl: "",
      currentEmbedUrl: "",
      contentLabel: "",
      status: null,
    });
    void closeCompanionBrowserWebview().finally(() => {
      closeCompanion();
    });
  }, [closeCompanion, setCompanionState]);

  const browserUrl = companion.currentUrl || DEFAULT_COMPANION_BROWSER_URL;
  const hostLabel = companionLabelForUrl(browserUrl);

  return (
    <aside className="companion-panel relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--vt-accent)_14%,var(--vt-border))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--vt-dropdown-bg)_94%,black_6%),color-mix(in_srgb,var(--vt-bg)_96%,black_4%))] shadow-[0_22px_54px_rgba(0,0,0,0.32)]">
      <div
        onMouseDown={(event) => {
          if (!floating || !onStartDrag) return;
          if ((event.target as HTMLElement).closest("button, input")) {
            return;
          }
          onStartDrag(event);
        }}
        className={`border-b border-[var(--vt-input-border)] px-3 py-2 ${
          floating ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-[var(--vt-dim-text)]">
              <span className="rounded-full border border-[var(--vt-input-border)] px-1.5 py-0.5">
                Companion Browser
              </span>
              <span>{floating ? "Floating" : `Docked ${companion.side}`}</span>
              <span className="opacity-50">•</span>
              <span>Native Webview</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <h2 className="min-w-0 truncate text-[13px] font-semibold text-[var(--vt-foreground)]">
                {companion.contentLabel || hostLabel || "Companion"}
              </h2>
              <span className="truncate text-[10px] text-[var(--vt-muted-text)]">
                {companion.status ?? `Showing ${hostLabel}`}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
            <CompanionToolbarButton
              type="button"
              onClick={() => openBrowser(DEFAULT_COMPANION_BROWSER_URL)}
              label="Open the home page"
            >
              Home
            </CompanionToolbarButton>
            <CompanionToolbarButton
              type="button"
              onClick={() => setCompanionState({ side: companion.side === "left" ? "right" : "left" })}
              label={companion.side === "left" ? "Dock right" : "Dock left"}
            >
              {companion.side === "left" ? "R" : "L"}
            </CompanionToolbarButton>
            <CompanionToolbarButton
              type="button"
              onClick={() => setCompanionState({ side: companion.side === "floating" ? "right" : "floating" })}
              label={companion.side === "floating" ? "Dock" : "Float"}
              active={companion.side === "floating"}
            >
              {companion.side === "floating" ? "Dock" : "Float"}
            </CompanionToolbarButton>
            <CompanionToolbarButton
              type="button"
              onClick={() => setChromeCollapsed((value) => !value)}
              label={chromeCollapsed ? "Show address bar" : "Hide address bar"}
              active={chromeCollapsed}
            >
              {chromeCollapsed ? "+" : "−"}
            </CompanionToolbarButton>
            <CompanionToolbarButton
              type="button"
              onClick={handleCloseCompanion}
              label="Close"
            >
              ✕
            </CompanionToolbarButton>
          </div>
        </div>

        {!chromeCollapsed && (
          <div className="mt-2 grid gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                ref={addressRef}
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openBrowser();
                  }
                }}
                className="w-full rounded-xl border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-bg)_88%,black_12%)] px-3 py-1.5 pr-16 text-[12px] text-[var(--vt-foreground)] outline-none transition-colors focus:border-[var(--vt-accent)]"
                placeholder="URL or search"
                title="Search the web or open a site in the native companion browser"
              />
              <button
                type="button"
                onClick={() => openBrowser()}
                className="absolute inset-y-1 right-1 cursor-pointer rounded-lg bg-[var(--vt-accent)] px-2.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                title="Go"
              >
                Go
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_LINKS.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  onClick={() => openBrowser(link.url)}
                  className="cursor-pointer rounded-lg border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-bg)_70%,transparent)] px-2 py-1 text-[10px] text-[var(--vt-muted-text)] transition-colors hover:text-[var(--vt-foreground)]"
                >
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-[var(--vt-bg)] p-1.5">
        <div className="relative h-full min-h-0 overflow-hidden rounded-[16px] border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-bg)_94%,black_6%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CompanionBrowserSurface
            url={browserUrl}
            onError={handleBrowserError}
          />
        </div>
      </div>

      {floating && onStartResize && (
        <button
          type="button"
          onMouseDown={onStartResize}
          className="absolute bottom-2 right-2 flex h-6 w-6 cursor-se-resize items-end justify-end rounded-full border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-chrome-bg)_88%,black_12%)] p-1 text-[10px] text-[var(--vt-muted-text)] transition-colors hover:text-[var(--vt-foreground)]"
          title="Resize floating companion panel"
        >
          ◢
        </button>
      )}
    </aside>
  );
}
