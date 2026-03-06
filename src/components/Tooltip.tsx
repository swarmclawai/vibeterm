import type { ReactNode } from "react";

interface TooltipProps {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

export function Tooltip({
  label,
  side = "top",
  children,
}: TooltipProps) {
  const bubbleClass =
    side === "bottom"
      ? "left-1/2 top-full mt-2 -translate-x-1/2"
      : "left-1/2 bottom-full mb-2 -translate-x-1/2";

  return (
    <span className="relative inline-flex group/vt-tooltip">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${bubbleClass} z-[80] whitespace-nowrap rounded-md border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-dropdown-bg)_96%,black_4%)] px-2 py-1 text-[10px] font-medium text-[var(--vt-foreground)] opacity-0 shadow-[0_10px_26px_rgba(0,0,0,0.24)] transition-opacity duration-150 group-hover/vt-tooltip:opacity-100 group-focus-within/vt-tooltip:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}
