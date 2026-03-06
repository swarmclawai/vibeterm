import { useCallback, useEffect, useRef } from "react";
import { useStore } from "../store";
import { GridContainer } from "./GridContainer";
import { CompanionPanel } from "./CompanionPanel";

function companionTemplateColumns(
  open: boolean,
  side: "left" | "right" | "floating",
  width: number,
): string {
  if (!open || side === "floating") return "minmax(0, 1fr)";
  if (side === "left") return `minmax(280px, ${width}px) 8px minmax(0, 1fr)`;
  return `minmax(0, 1fr) 8px minmax(280px, ${width}px)`;
}

export function WorkspaceShell() {
  const companion = useStore((state) => state.companion);
  const setCompanionState = useStore((state) => state.setCompanionState);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gridResetKey = companion.open && companion.side !== "floating"
    ? `grid-${companion.side}`
    : "grid-main";

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (companion.side === "floating") return;

    const startX = event.clientX;
    const startWidth = companion.width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const width = companion.side === "right"
        ? startWidth - delta
        : startWidth + delta;
      setCompanionState({ width });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [companion.side, companion.width, setCompanionState]);

  const clampFloatingPosition = useCallback((left: number, top: number) => {
    const containerRect = shellRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return {
        left: Math.max(0, Math.round(left)),
        top: Math.max(0, Math.round(top)),
      };
    }

    return {
      left: Math.max(0, Math.min(Math.round(left), Math.max(0, containerRect.width - companion.width))),
      top: Math.max(0, Math.min(Math.round(top), Math.max(0, containerRect.height - companion.height))),
    };
  }, [companion.height, companion.width]);

  useEffect(() => {
    if (!companion.open || companion.side !== "floating") return;
    const { left, top } = clampFloatingPosition(companion.floatingX, companion.floatingY);
    if (left !== companion.floatingX || top !== companion.floatingY) {
      setCompanionState({ floatingX: left, floatingY: top });
    }
  }, [
    clampFloatingPosition,
    companion.floatingX,
    companion.floatingY,
    companion.open,
    companion.side,
    setCompanionState,
  ]);

  const startFloatingDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (companion.side !== "floating") return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = companion.floatingX;
    const originTop = companion.floatingY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const { left, top } = clampFloatingPosition(originLeft + deltaX, originTop + deltaY);
      setCompanionState({ floatingX: left, floatingY: top });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [
    clampFloatingPosition,
    companion.floatingX,
    companion.floatingY,
    companion.side,
    setCompanionState,
  ]);

  const startFloatingResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (companion.side !== "floating") return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = companion.width;
    const startHeight = companion.height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const containerRect = shellRef.current?.getBoundingClientRect();
      const maxWidth = containerRect
        ? Math.max(280, Math.floor(containerRect.width - companion.floatingX))
        : 720;
      const maxHeight = containerRect
        ? Math.max(260, Math.floor(containerRect.height - companion.floatingY))
        : 720;
      const width = Math.max(280, Math.min(startWidth + (moveEvent.clientX - startX), maxWidth));
      const height = Math.max(260, Math.min(startHeight + (moveEvent.clientY - startY), maxHeight));
      setCompanionState({ width, height });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [
    companion.floatingX,
    companion.floatingY,
    companion.height,
    companion.side,
    companion.width,
    setCompanionState,
  ]);

  const floatingStyle = companion.side === "floating" && companion.open
    ? {
        width: `${companion.width}px`,
        height: `${companion.height}px`,
        left: `${companion.floatingX}px`,
        top: `${companion.floatingY}px`,
      }
    : undefined;

  return (
    <div ref={shellRef} className="relative flex h-full flex-1 min-h-0 min-w-0 overflow-hidden">
      <div
        className="grid h-full w-full flex-1 min-h-0 min-w-0 gap-0"
        style={{
          gridTemplateColumns: companionTemplateColumns(
            companion.open,
            companion.side,
            companion.width,
          ),
          gridTemplateRows: "minmax(0, 1fr)",
        }}
      >
        {companion.open && companion.side === "left" && <CompanionPanel />}
        {companion.open && companion.side === "left" && (
          <div
            onMouseDown={startResize}
            className="companion-resize-handle"
            title="Resize the companion panel"
          />
        )}

        <div className="h-full w-full min-h-0 min-w-0">
          <GridContainer key={gridResetKey} />
        </div>

        {companion.open && companion.side === "right" && (
          <div
            onMouseDown={startResize}
            className="companion-resize-handle"
            title="Resize the companion panel"
          />
        )}
        {companion.open && companion.side === "right" && <CompanionPanel />}
      </div>

      {companion.open && companion.side === "floating" && (
        <div
          className="absolute z-30 min-h-0 min-w-0"
          style={floatingStyle}
        >
          <div className="h-full min-h-0 min-w-0">
            <CompanionPanel
              floating
              onStartDrag={startFloatingDrag}
              onStartResize={startFloatingResize}
            />
          </div>
        </div>
      )}
    </div>
  );
}
