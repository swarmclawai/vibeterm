import { useRef } from "react";
import { GridContainer } from "./GridContainer";

export function WorkspaceShell() {
  const shellRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={shellRef} className="relative flex h-full flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="h-full w-full min-h-0 min-w-0">
        <GridContainer />
      </div>
    </div>
  );
}
