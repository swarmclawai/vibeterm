import { Group, Panel, Separator } from "react-resizable-panels";
import { useStore } from "../store";
import { TerminalPane } from "./TerminalPane";
import { EmptyPane } from "./EmptyPane";

function PaneSlot({ index, inset = 0 }: { index: number; inset?: number }) {
  const sessionId = useStore((s) => s.panes[index]?.sessionId ?? null);
  return (
    <div
      className="flex h-full w-full flex-1 min-h-0 min-w-0"
      style={inset > 0 ? { padding: `${inset}px` } : undefined}
    >
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

  const containerInset = glowEnabled
    ? Math.max(gap, Math.ceil(glowWidth * 0.9))
    : Math.max(gap, 6);
  const paneInset = rows * cols > 1 && maximizedPane === null && glowEnabled
    ? Math.max(2, Math.ceil(Math.min(gap / 2, glowWidth * 0.5)))
    : 0;

  let content: React.ReactNode;

  if (maximizedPane !== null) {
    content = <PaneSlot index={maximizedPane} />;
  } else if (rows === 1 && cols === 1) {
    // Single pane — no resizable groups needed
    content = <PaneSlot index={0} />;
  } else if (rows === 1) {
    // Single row — horizontal only
    content = (
      <Group orientation="horizontal" className="flex h-full w-full flex-1 min-h-0 min-w-0">
        {Array.from({ length: cols }, (_, c) => (
          <Panel key={c} minSize={5} className="h-full min-h-0 min-w-0" style={{ overflow: "visible" }}>
            <PaneSlot index={c} inset={paneInset} />
          </Panel>
        )).flatMap((panel, i) =>
          i < cols - 1
            ? [panel, <Separator key={`sep-${i}`} className="cursor-col-resize" style={{ width: `${gap}px` }} />]
            : [panel],
        )}
      </Group>
    );
  } else if (cols === 1) {
    // Single col — vertical only
    content = (
      <Group orientation="vertical" className="flex h-full w-full flex-1 min-h-0 min-w-0">
        {Array.from({ length: rows }, (_, r) => (
          <Panel key={r} minSize={5} className="h-full min-h-0 min-w-0" style={{ overflow: "visible" }}>
            <PaneSlot index={r} inset={paneInset} />
          </Panel>
        )).flatMap((panel, i) =>
          i < rows - 1
            ? [panel, <Separator key={`sep-${i}`} className="cursor-row-resize" style={{ height: `${gap}px` }} />]
            : [panel],
        )}
      </Group>
    );
  } else {
    // General NxM grid: vertical group of rows, each row is a horizontal group
    content = (
      <Group orientation="vertical" className="flex h-full w-full flex-1 min-h-0 min-w-0">
        {Array.from({ length: rows }, (_, r) => (
          <Panel key={r} minSize={5} className="h-full min-h-0 min-w-0" style={{ overflow: "visible" }}>
            <Group orientation="horizontal" className="flex h-full w-full min-h-0 min-w-0">
              {Array.from({ length: cols }, (_, c) => (
                <Panel key={c} minSize={5} className="h-full min-h-0 min-w-0" style={{ overflow: "visible" }}>
                  <PaneSlot index={r * cols + c} inset={paneInset} />
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

  return (
    <div
      className="flex h-full w-full flex-1 min-h-0 min-w-0"
      style={{ padding: `${containerInset}px` }}
    >
      <div className="flex h-full w-full flex-1 min-h-0 min-w-0">
        {content}
      </div>
    </div>
  );
}
