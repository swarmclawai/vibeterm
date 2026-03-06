import { useCallback, useMemo } from "react";
import { useTerminal, clearSessionBuffer } from "../hooks/useTerminal";
import { TaskLabel } from "./TaskLabel";
import { killSession, updateTask, createSessionInDir } from "../lib/tauri";
import { useStore } from "../store";

interface TerminalPaneProps {
  sessionId: string;
  paneIndex: number;
}

export function TerminalPane({ sessionId, paneIndex }: TerminalPaneProps) {
  const session = useStore((s) => s.sessions[sessionId]);
  const focusedPane = useStore((s) => s.focusedPane);
  const maximizedPane = useStore((s) => s.maximizedPane);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const removeSession = useStore((s) => s.removeSession);
  const swapPanes = useStore((s) => s.swapPanes);
  const draggingPane = useStore((s) => s.draggingPane);
  const setDraggingPane = useStore((s) => s.setDraggingPane);

  const { containerRef, focus } = useTerminal(sessionId);

  const handleFocus = useCallback(() => {
    setFocusedPane(paneIndex);
    focus();
  }, [paneIndex, setFocusedPane, focus]);

  const handleClose = useCallback(async () => {
    await killSession(sessionId).catch(() => {});
    clearSessionBuffer(sessionId);
    removeSession(sessionId);
  }, [sessionId, removeSession]);

  const handleMaximize = useCallback(() => {
    toggleMaximize(paneIndex);
  }, [paneIndex, toggleMaximize]);

  const handleRename = useCallback(
    (label: string) => {
      updateTask(sessionId, label).catch(() => {});
      useStore.getState().updateTaskStatus(sessionId, session.task.status);
      useStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            task: { ...state.sessions[sessionId].task, label },
          },
        },
      }));
    },
    [sessionId, session?.task.status],
  );

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only left click, ignore if interacting with buttons
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging) {
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (dx > 5 || dy > 5) {
            dragging = true;
            setDraggingPane(paneIndex);
          }
          return;
        }
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (dragging) {
          // Drop is handled by the overlay's onMouseUp
          // If we're still dragging (no drop target), just cancel
          setDraggingPane(null);
        }
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [paneIndex, setDraggingPane],
  );

  const addSession = useStore((s) => s.addSession);
  const getNextEmptySlot = useStore((s) => s.getNextEmptySlot);
  const cwd = useStore((s) => s.sessionCwds[sessionId]);

  const handleClone = useCallback(async () => {
    if (!cwd) return;
    const slot = getNextEmptySlot();
    if (slot === -1) return;
    try {
      const info = await createSessionInDir("Terminal", cwd, {
        launcherId: session.launcher_id,
        resumeMode: "new",
      });
      addSession(info, slot);
    } catch {
      // ignore
    }
  }, [cwd, getNextEmptySlot, addSession]);

  const handleDropTarget = useCallback(() => {
    if (draggingPane !== null && draggingPane !== paneIndex) {
      swapPanes(draggingPane, paneIndex);
    }
    setDraggingPane(null);
  }, [draggingPane, paneIndex, swapPanes, setDraggingPane]);

  const glowEnabled = useStore((s) => s.settings.glowEnabled);
  const glowIntensity = useStore((s) => s.settings.glowIntensity);
  const borderRadius = useStore((s) => s.settings.borderRadius);

  const glowStyle = useMemo(
    () =>
      ({
        "--glow-intensity": glowIntensity,
      }) as React.CSSProperties,
    [glowIntensity],
  );

  if (!session) return null;

  const isFocused = focusedPane === paneIndex;
  const isDragging = draggingPane !== null;
  const isDropTarget = isDragging && draggingPane !== paneIndex;
  const isBeingDragged = draggingPane === paneIndex;

  return (
    <div
      className={`flex flex-col h-full w-full select-none ${isFocused && glowEnabled ? "pane-glow" : ""}`}
      style={{
        ...(isFocused && glowEnabled ? glowStyle : {}),
        opacity: isBeingDragged ? 0.5 : 1,
      }}
      onClick={handleFocus}
    >
      <div className="relative z-[1] flex flex-col flex-1 min-h-0 overflow-visible" style={{ borderRadius: `${borderRadius}px` }}>
        <TaskLabel
          task={session.task}
          isFocused={isFocused}
          isMaximized={maximizedPane === paneIndex}
          cwd={cwd}
          launcherLabel={session.launcher_label}
          resumeMode={session.resume_mode}
          providerSessionId={session.provider_session_id}
          onRename={handleRename}
          onMaximize={handleMaximize}
          onClose={handleClose}
          onClone={cwd ? handleClone : undefined}
          onDragHandleMouseDown={handleTitleMouseDown}
        />
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden px-2" />
        {isDropTarget && (
          <div
            onMouseUp={handleDropTarget}
            onMouseEnter={(e) => e.currentTarget.dataset.hover = "true"}
            onMouseLeave={(e) => e.currentTarget.dataset.hover = "false"}
            className="absolute inset-0 z-20 rounded-[inherit] border-2 border-[var(--vt-accent)] bg-[var(--vt-accent)]/10 cursor-pointer transition-colors hover:bg-[var(--vt-accent)]/20"
          />
        )}
      </div>
    </div>
  );
}
