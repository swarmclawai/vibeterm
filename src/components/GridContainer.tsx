import { Group, Panel, Separator } from "react-resizable-panels";
import { useStore } from "../store";
import { TerminalPane } from "./TerminalPane";
import { EmptyPane } from "./EmptyPane";

function PaneSlot({ index }: { index: number }) {
  const sessionId = useStore((s) => s.panes[index]?.sessionId ?? null);
  return (
    <div className="h-full w-full min-h-0 min-w-0">
      {sessionId
        ? <TerminalPane sessionId={sessionId} paneIndex={index} />
        : <EmptyPane paneIndex={index} />}
    </div>
  );
}

export function GridContainer() {
  const { rows, cols } = useStore((s) => s.grid);
  const maximizedPane = useStore((s) => s.maximizedPane);
  const gap = useStore((s) => s.settings.gap);
  const glowEnabled = useStore((s) => s.settings.glowEnabled);
  const glowWidth = useStore((s) => s.settings.glowWidth);

  const singlePaneInset = glowEnabled
    ? Math.max(gap, Math.ceil(glowWidth * 0.9))
    : Math.max(gap, 6);

  if (maximizedPane !== null) {
    return (
      <div
        className="flex h-full w-full flex-1 min-h-0 min-w-0"
        style={{ padding: `${singlePaneInset}px` }}
      >
        <PaneSlot index={maximizedPane} />
      </div>
    );
  }

  // Single pane — no resizable groups needed
  if (rows === 1 && cols === 1) {
    return (
      <div
        className="flex h-full w-full flex-1 min-h-0 min-w-0"
        style={{ padding: `${singlePaneInset}px` }}
      >
        <PaneSlot index={0} />
      </div>
    );
  }

  // Single row — horizontal only
  if (rows === 1) {
    return (
      <Group orientation="horizontal" className="flex h-full w-full flex-1 min-h-0">
        {Array.from({ length: cols }, (_, c) => (
          <Panel key={c} minSize={5} className="h-full" style={{ overflow: "visible" }}>
            <PaneSlot index={c} />
          </Panel>
        )).flatMap((panel, i) =>
          i < cols - 1
            ? [panel, <Separator key={`sep-${i}`} className="cursor-col-resize" style={{ width: `${gap}px` }} />]
            : [panel],
        )}
      </Group>
    );
  }

  // Single col — vertical only
  if (cols === 1) {
    return (
      <Group orientation="vertical" className="flex h-full w-full flex-1 min-h-0">
        {Array.from({ length: rows }, (_, r) => (
          <Panel key={r} minSize={5} className="h-full" style={{ overflow: "visible" }}>
            <PaneSlot index={r} />
          </Panel>
        )).flatMap((panel, i) =>
          i < rows - 1
            ? [panel, <Separator key={`sep-${i}`} className="cursor-row-resize" style={{ height: `${gap}px` }} />]
            : [panel],
        )}
      </Group>
    );
  }

  // General NxM grid: vertical group of rows, each row is a horizontal group
  return (
    <Group orientation="vertical" className="flex h-full w-full flex-1 min-h-0">
      {Array.from({ length: rows }, (_, r) => (
        <Panel key={r} minSize={5} className="h-full" style={{ overflow: "visible" }}>
          <Group orientation="horizontal" className="flex h-full w-full min-h-0">
            {Array.from({ length: cols }, (_, c) => (
              <Panel key={c} minSize={5} className="h-full" style={{ overflow: "visible" }}>
                <PaneSlot index={r * cols + c} />
              </Panel>
            )).flatMap((panel, i) =>
              i < cols - 1
                ? [panel, <Separator key={`hsep-${r}-${i}`} className="cursor-col-resize" style={{ width: `${gap}px` }} />]
                : [panel],
            )}
          </Group>
        </Panel>
      )).flatMap((panel, i) =>
        i < rows - 1
          ? [panel, <Separator key={`vsep-${i}`} className="cursor-row-resize" style={{ height: `${gap}px` }} />]
          : [panel],
      )}
    </Group>
  );
}
