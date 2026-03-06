import { useEffect, useMemo, useState } from "react";
import { SessionLauncherPanel } from "./SessionLauncherPanel";
import { useStore } from "../store";
import { getLaunchDirectory } from "../lib/tauri";

interface EmptyPaneProps {
  paneIndex: number;
}

export function EmptyPane({ paneIndex }: EmptyPaneProps) {
  const addSession = useStore((s) => s.addSession);
  const panes = useStore((s) => s.panes);
  const focusedPane = useStore((s) => s.focusedPane);
  const sessionCwds = useStore((s) => s.sessionCwds);
  const [startupDirectory, setStartupDirectory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLaunchDirectory()
      .then((value) => {
        if (!cancelled && value?.trim()) {
          setStartupDirectory(value.trim());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultCwd = useMemo(() => {
    const focusedSessionId = panes[focusedPane]?.sessionId;
    if (focusedSessionId && sessionCwds[focusedSessionId]) {
      return sessionCwds[focusedSessionId];
    }
    if (startupDirectory?.trim()) {
      return startupDirectory.trim();
    }
    return Object.values(sessionCwds).find((cwd) => cwd.trim().length > 0);
  }, [focusedPane, panes, sessionCwds, startupDirectory]);

  return (
    <SessionLauncherPanel
      defaultCwd={defaultCwd}
      onCreated={(info) => addSession(info, paneIndex)}
    />
  );
}
