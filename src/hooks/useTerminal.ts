import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  writeToSession,
  resizeSession,
  onPtyOutput,
  onSessionExit,
  getSessionCwd,
} from "../lib/tauri";
import { useStore } from "../store";

// Buffer PTY output per session so terminals can be replayed after swap/remount
const outputBuffers = new Map<string, { chunks: Uint8Array[]; totalBytes: number }>();
const MAX_BUFFER_BYTES = 512_000;

function bufferOutput(sessionId: string, bytes: Uint8Array) {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = { chunks: [], totalBytes: 0 };
    outputBuffers.set(sessionId, buf);
  }
  buf.chunks.push(bytes);
  buf.totalBytes += bytes.length;
  while (buf.totalBytes > MAX_BUFFER_BYTES && buf.chunks.length > 1) {
    buf.totalBytes -= buf.chunks[0].length;
    buf.chunks.shift();
  }
}

export function clearSessionBuffer(sessionId: string) {
  outputBuffers.delete(sessionId);
}

export function useTerminal(sessionId: string) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const updateTaskStatus = useStore((s) => s.updateTaskStatus);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    updateTaskStatus(sessionId, "running");
    idleTimerRef.current = setTimeout(() => {
      updateTaskStatus(sessionId, "idle");
    }, 30_000);
  }, [sessionId, updateTaskStatus]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialSettings = useStore.getState().settings;
    const initialTheme = useStore.getState().themePreview ?? useStore.getState().theme;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: initialSettings.fontSize,
      fontFamily: initialSettings.fontFamily,
      cursorStyle: initialSettings.cursorStyle,
      scrollback: initialSettings.scrollback,
      theme: initialTheme.terminal,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // Initial fit
    requestAnimationFrame(() => {
      fit.fit();
      resizeSession(sessionId, term.cols, term.rows).catch(() => {});
    });

    termRef.current = term;
    fitRef.current = fit;

    // Replay buffered output from previous mount
    const buffered = outputBuffers.get(sessionId);
    if (buffered) {
      for (const chunk of buffered.chunks) {
        term.write(chunk);
      }
    }

    // Forward input to PTY
    const dataDisposable = term.onData((data) => {
      writeToSession(sessionId, data).catch(() => {});
    });

    // Listen for PTY output
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    onPtyOutput(sessionId, (base64Data) => {
      const bytes = Uint8Array.from(atob(base64Data), (c) =>
        c.charCodeAt(0),
      );
      term.write(bytes);
      bufferOutput(sessionId, bytes);
      resetIdleTimer();
    }).then((fn) => {
      unlistenOutput = fn;
    });

    onSessionExit(sessionId, () => {
      updateTaskStatus(sessionId, "completed");
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    }).then((fn) => {
      unlistenExit = fn;
    });

    // ResizeObserver for container
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fit.fit();
        resizeSession(sessionId, term.cols, term.rows).catch(() => {});
      });
    });
    ro.observe(container);

    // Start idle timer
    resetIdleTimer();

    // Poll CWD — once on mount, then debounced after terminal activity
    let cwdTimeout: ReturnType<typeof setTimeout> | null = null;
    let cwdPolling = false;
    const pollCwd = () => {
      if (cwdPolling) return;
      cwdPolling = true;
      getSessionCwd(sessionId)
        .then((cwd) => useStore.getState().setSessionCwd(sessionId, cwd))
        .catch(() => {})
        .finally(() => { cwdPolling = false; });
    };
    const debouncedCwdPoll = () => {
      if (cwdTimeout) clearTimeout(cwdTimeout);
      cwdTimeout = setTimeout(pollCwd, 2000);
    };
    pollCwd();
    const inputDisposable = term.onData(() => debouncedCwdPoll());

    // Live theme switching
    let prevTheme = initialTheme;
    const unsubTheme = useStore.subscribe((state) => {
      const nextTheme = state.themePreview ?? state.theme;
      if (nextTheme !== prevTheme) {
        prevTheme = nextTheme;
        term.options.theme = nextTheme.terminal;
      }
    });

    // Live settings switching
    let prevSettings = useStore.getState().settings;
    const unsubSettings = useStore.subscribe((state) => {
      if (state.settings !== prevSettings) {
        const s = state.settings;
        const prev = prevSettings;
        prevSettings = s;
        if (s.fontSize !== prev.fontSize) term.options.fontSize = s.fontSize;
        if (s.fontFamily !== prev.fontFamily) term.options.fontFamily = s.fontFamily;
        if (s.cursorStyle !== prev.cursorStyle) term.options.cursorStyle = s.cursorStyle;
        if (s.scrollback !== prev.scrollback) term.options.scrollback = s.scrollback;
        requestAnimationFrame(() => {
          fit.fit();
          resizeSession(sessionId, term.cols, term.rows).catch(() => {});
        });
      }
    });

    return () => {
      unsubSettings();
      unsubTheme();
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      ro.disconnect();
      inputDisposable.dispose();
      if (cwdTimeout) clearTimeout(cwdTimeout);
      term.dispose();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [sessionId, updateTaskStatus, resetIdleTimer]);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { containerRef, focus };
}
