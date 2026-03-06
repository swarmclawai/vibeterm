import { useMemo } from "react";
import { SessionLauncherPanel } from "./SessionLauncherPanel";
import { useStore } from "../store";

interface EmptyPaneProps {
  paneIndex: number;
}

export function EmptyPane({ paneIndex }: EmptyPaneProps) {
  const addSession = useStore((s) => s.addSession);
  const panes = useStore((s) => s.panes);
  const focusedPane = useStore((s) => s.focusedPane);
  const sessionCwds = useStore((s) => s.sessionCwds);

  const defaultCwd = useMemo(() => {
    const focusedSessionId = panes[focusedPane]?.sessionId;
    if (focusedSessionId && sessionCwds[focusedSessionId]) {
      return sessionCwds[focusedSessionId];
    }
    return Object.values(sessionCwds).find((cwd) => cwd.trim().length > 0);
  }, [focusedPane, panes, sessionCwds]);

  return (
    <SessionLauncherPanel
      defaultCwd={defaultCwd}
      onCreated={(info) => addSession(info, paneIndex)}
    />
  );
}
