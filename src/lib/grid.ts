import { clearSessionBuffer } from "../hooks/useTerminal";
import { useStore } from "../store";
import { killSession } from "./tauri";

export async function changeGridWithWarning(
  rows: number,
  cols: number,
): Promise<boolean> {
  const state = useStore.getState();

  if (rows === state.grid.rows && cols === state.grid.cols) {
    return true;
  }

  const removedIds = state.getSessionsOutsideGrid(rows, cols);

  // If shrinking would kill active sessions, show a confirmation modal
  if (removedIds.length) {
    state.setPendingGridChange({ rows, cols, removedSessionIds: removedIds });
    return false;
  }

  state.setGrid(rows, cols);
  return true;
}

export async function confirmPendingGridChange(): Promise<void> {
  const state = useStore.getState();
  const pending = state.pendingGridChange;
  if (!pending) return;

  const { rows, cols, removedSessionIds } = pending;
  state.setPendingGridChange(null);
  state.setGrid(rows, cols);

  // Clean up killed sessions in background
  void Promise.allSettled(
    removedSessionIds.map(async (sessionId) => {
      await killSession(sessionId).catch(() => {});
      clearSessionBuffer(sessionId);
    }),
  );
}

export function cancelPendingGridChange(): void {
  useStore.getState().setPendingGridChange(null);
}
