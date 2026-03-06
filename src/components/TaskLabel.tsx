import { useState, useRef, useEffect } from "react";
import type { TaskMetadata } from "../lib/tauri";

const STATUS_COLORS: Record<TaskMetadata["status"], string> = {
  running: "bg-green-500",
  idle: "bg-yellow-500",
  errored: "bg-red-500",
  completed: "bg-gray-500",
};

interface TaskLabelProps {
  task: TaskMetadata;
  isFocused: boolean;
  isMaximized: boolean;
  cwd?: string;
  launcherLabel?: string;
  resumeMode?: string;
  providerSessionId?: string;
  onRename: (label: string) => void;
  onMaximize: () => void;
  onClose: () => void;
  onClone?: () => void;
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

function dirName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function shortLauncherLabel(label: string): string {
  return label.replace(/\s+CLI$/i, "");
}

function launcherTooltip(
  launcherLabel?: string,
  resumeMode?: string,
  providerSessionId?: string,
): string {
  if (!launcherLabel) return "";
  if (resumeMode === "last") {
    return `${launcherLabel} · resuming latest session`;
  }
  if (resumeMode === "session" && providerSessionId) {
    return `${launcherLabel} · resuming ${providerSessionId}`;
  }
  return launcherLabel;
}

function HeaderIconButton({
  tooltip,
  active = false,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip: string;
  active?: boolean;
}) {
  return (
    <button
      {...props}
      data-tip={tooltip}
      data-tip-side="top"
      className={`vt-tooltip-trigger cursor-pointer rounded px-1 text-sm transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--vt-accent)_14%,transparent)] text-[var(--vt-foreground)]"
          : "text-[var(--vt-muted-text)] hover:text-[var(--vt-foreground)] hover:bg-[var(--vt-border)]"
      } ${className}`}
      title={tooltip}
    >
      {children}
    </button>
  );
}

export function TaskLabel({
  task,
  isFocused,
  isMaximized,
  cwd,
  launcherLabel,
  resumeMode,
  providerSessionId,
  onRename,
  onMaximize,
  onClose,
  onClone,
  onDragHandleMouseDown,
}: TaskLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.label) {
      onRename(trimmed);
    } else {
      setDraft(task.label);
    }
    setEditing(false);
  };

  return (
    <div
      className={`relative z-[3] flex items-center gap-2 overflow-visible px-3 py-1.5 text-[13px] select-none shrink-0 ${
        isFocused ? "bg-[var(--vt-chrome-bg)]" : "bg-[var(--vt-bg)]"
      }`}
    >
      {onDragHandleMouseDown && (
        <span
          onMouseDown={onDragHandleMouseDown}
          data-tip="Drag to reorder"
          data-tip-side="top"
          className="vt-tooltip-trigger cursor-grab active:cursor-grabbing text-[var(--vt-dim-text)] hover:text-[var(--vt-muted-text)] shrink-0 leading-none text-sm"
          title="Drag to reorder"
        >
          ⠿
        </span>
      )}
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLORS[task.status]}`}
        title={task.status}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(task.label);
              setEditing(false);
            }
            e.stopPropagation();
          }}
          className="flex-1 min-w-0 bg-[var(--vt-bg)] border border-[var(--vt-input-border)] rounded px-1 py-0 text-[13px] text-[var(--vt-foreground)] outline-none focus:border-[var(--vt-accent)]"
        />
      ) : (
        <span
          className="truncate flex-1 text-[var(--vt-muted-text)] cursor-text"
          onDoubleClick={() => {
            setDraft(task.label);
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          {task.label}
        </span>
      )}
      {launcherLabel && (
        <span
          data-tip={launcherTooltip(launcherLabel, resumeMode, providerSessionId)}
          data-tip-side="top"
          className="vt-tooltip-trigger shrink-0 rounded-full border border-[var(--vt-input-border)] bg-[color-mix(in_srgb,var(--vt-accent)_9%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--vt-foreground)]"
          title={launcherTooltip(launcherLabel, resumeMode, providerSessionId)}
        >
          {shortLauncherLabel(launcherLabel)}
        </span>
      )}
      {cwd && (
        <span
          className="text-[11px] text-[var(--vt-dim-text)] truncate max-w-[120px]"
          title={cwd}
        >
          {dirName(cwd)}
        </span>
      )}
      {onClone && (
        <HeaderIconButton
          onClick={onClone}
          tooltip="Clone in the same directory"
        >
          ⊕
        </HeaderIconButton>
      )}
      <HeaderIconButton
        onClick={onMaximize}
        tooltip={isMaximized ? "Restore pane" : "Maximize pane"}
      >
        {isMaximized ? "⊟" : "⊞"}
      </HeaderIconButton>
      <HeaderIconButton
        onClick={onClose}
        tooltip="Close terminal"
        className="hover:text-red-400"
      >
        ✕
      </HeaderIconButton>
    </div>
  );
}
