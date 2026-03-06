# Vibe Terminal — Technical Specification

## Overview

Vibe Terminal is a purpose-built terminal multiplexer for AI-assisted ("vibe") coding. It allows developers to spawn multiple terminal panes in configurable grid layouts, track which task each terminal is working on, and manage concurrent AI coding agents from a single interface.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| App shell | **Tauri v2** | Native desktop app, Rust backend for PTY management |
| Frontend | **React + TypeScript** | UI components, layout system, state management |
| Terminal rendering | **xterm.js** + FitAddon + WebLinksAddon | Terminal emulation in each pane |
| Layout / resize | **react-resizable-panels** | Drag-to-resize grid panes |
| State management | **Zustand** | Terminal sessions, task metadata, layout configs |
| Backend PTY | **portable-pty** (Rust crate) | Spawn and manage real pseudo-terminal processes |
| IPC | **Tauri commands + events** | Stream PTY output to frontend, send keystrokes to backend |
| Styling | **Tailwind CSS** | Theming, utility-first layout |

---

## Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────┐
│                  Tauri Webview                   │
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ xterm.js│  │ xterm.js│  │ xterm.js│  ...    │
│  │ Pane 1  │  │ Pane 2  │  │ Pane 3  │        │
│  └────┬────┘  └────┬────┘  └────┬────┘        │
│       │             │             │              │
│       └─────────────┼─────────────┘              │
│                     │ Tauri IPC                  │
├─────────────────────┼───────────────────────────┤
│                     │                            │
│  ┌──────────────────▼───────────────────────┐   │
│  │          Rust Backend (Tauri)             │   │
│  │                                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │   │
│  │  │  PTY 1   │ │  PTY 2   │ │  PTY 3   │ │   │
│  │  │ (zsh)    │ │ (zsh)    │ │ (zsh)    │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ │   │
│  │                                           │   │
│  │  ┌──────────────────────────────────┐    │   │
│  │  │  Session Manager                  │    │   │
│  │  │  - session registry               │    │   │
│  │  │  - task metadata store            │    │   │
│  │  │  - output stream parser           │    │   │
│  │  └──────────────────────────────────┘    │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Backend (Rust / Tauri)

The Rust backend is responsible for:

1. **PTY Management** — Spawning, reading from, writing to, and destroying pseudo-terminal processes using the `portable-pty` crate. Each terminal pane maps to exactly one PTY session.

2. **Session Registry** — An in-memory map (`HashMap<SessionId, Session>`) tracking all active terminal sessions and their metadata (task name, status, shell PID, created timestamp, etc.).

3. **Output Streaming** — Each PTY has an async read loop (via tokio) that reads output bytes and emits them to the frontend over Tauri events, scoped to the session ID.

4. **Input Forwarding** — A Tauri command that accepts keystrokes from the frontend and writes them to the corresponding PTY's writer handle.

5. **Resize Handling** — A Tauri command that accepts new (cols, rows) dimensions from the frontend and resizes the PTY accordingly.

6. **Output Parsing (optional/future)** — A middleware layer that inspects the raw PTY output to detect task status signals (e.g., Claude CLI status changes, error patterns, process exit).

#### Key Rust Types

```rust
struct Session {
    id: SessionId,
    pty: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    task: TaskMetadata,
    created_at: chrono::DateTime<chrono::Utc>,
}

struct TaskMetadata {
    name: String,              // user-provided label, e.g. "backend auth refactor"
    description: Option<String>,
    status: TaskStatus,
    command: Option<String>,   // the initial command run, e.g. "claude"
}

enum TaskStatus {
    Running,
    Idle,
    Errored,
    Completed,
}
```

#### Tauri Commands (IPC API)

| Command | Direction | Description |
|---|---|---|
| `create_session(shell: Option<String>, task_name: String)` | Frontend → Backend | Spawn a new PTY + shell process, return session ID |
| `write_to_session(session_id, data: Vec<u8>)` | Frontend → Backend | Forward keystrokes to PTY |
| `resize_session(session_id, cols: u16, rows: u16)` | Frontend → Backend | Resize PTY dimensions |
| `kill_session(session_id)` | Frontend → Backend | Kill PTY process and clean up |
| `list_sessions()` | Frontend → Backend | Return all active sessions with metadata |
| `update_task(session_id, task: TaskMetadata)` | Frontend → Backend | Update task name/description/status |
| `session_output` (event) | Backend → Frontend | Stream PTY output bytes, tagged with session ID |
| `session_exit` (event) | Backend → Frontend | Notify frontend when a PTY process exits |

---

### Frontend (React + TypeScript)

#### Component Tree

```
<App>
  <TopBar />                         // layout presets, new pane button, global controls
  <GridContainer>                    // manages the overall grid layout
    <PanelGroup direction="vertical">  // react-resizable-panels (rows)
      <Panel>
        <PanelGroup direction="horizontal">  // (columns within row)
          <Panel>
            <TerminalPane sessionId="..." />
          </Panel>
          <PanelResizeHandle />       // draggable column divider
          <Panel>
            <TerminalPane sessionId="..." />
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle />           // draggable row divider
      <Panel>
        ...
      </Panel>
    </PanelGroup>
  </GridContainer>
  <StatusBar />                      // active session count, system info
</App>
```

#### Key Components

**`<TerminalPane>`**
- Renders an xterm.js `Terminal` instance attached to a `<div>` ref
- Attaches the `FitAddon` and calls `fitAddon.fit()` on mount and on container resize (via `ResizeObserver`)
- Listens to Tauri `session_output` events filtered by its `sessionId` and writes data to the terminal
- Captures keyboard input via xterm's `onData` handler and forwards it to the backend via `write_to_session`
- Reports dimension changes (from FitAddon) to the backend via `resize_session`
- Displays a **task label bar** at the top of the pane showing the task name, status indicator (colored dot), and a maximize/close button

**`<GridContainer>`**
- Accepts a `LayoutConfig` and renders a nested `PanelGroup` structure from `react-resizable-panels`
- Handles layout presets (1x1, 2x1, 2x2, 3x1, 3x3, etc.) by remapping the panel tree
- Each leaf `<Panel>` contains a `<TerminalPane>` or an `<EmptyPane>` (with a "+" button to spawn a new session)

**`<TopBar>`**
- Layout preset selector (grid of small icons: ▣, ▥, ▦, etc.)
- "New Terminal" button (spawns a pane, prompts for task name)
- "New Task" button (spawns a pane with a specific command, e.g., `claude "build the auth module"`)
- Global search / command palette (Cmd+K)

---

## Layout System

### Layout Model

```typescript
interface LayoutConfig {
  id: string;
  name: string;                    // e.g. "3x2 Grid"
  rows: PanelRow[];
}

interface PanelRow {
  sizePct: number;                 // initial height as percentage
  columns: PanelColumn[];
}

interface PanelColumn {
  sizePct: number;                 // initial width as percentage
  sessionId: string | null;        // null = empty slot
}
```

### Layout Presets

| Preset | Description | Grid |
|---|---|---|
| `single` | One fullscreen pane | 1×1 |
| `split-h` | Two panes side by side | 1×2 |
| `split-v` | Two panes stacked | 2×1 |
| `quad` | Four equal panes | 2×2 |
| `three-col` | Three columns | 1×3 |
| `three-row` | Three rows | 3×1 |
| `grid-3x3` | Nine panes | 3×3 |
| `main-side` | One large pane left, two stacked right (70/30) | custom |

### Resize Behavior

- **Drag handles** between every adjacent row and column, rendered by `<PanelResizeHandle>` from react-resizable-panels
- Minimum pane size: 10% of row/column (prevents collapsing to zero)
- **Maximize pane**: double-click on a pane's title bar (or press Cmd+Shift+Enter) to toggle it fullscreen; press Escape or repeat the shortcut to restore
- **On resize**: each affected `<TerminalPane>` fires its `ResizeObserver` callback → calls `fitAddon.fit()` → reports new (cols, rows) to backend via `resize_session`

### Adding / Removing Panes

- Clicking "+" in an empty pane slot spawns a new session in that slot
- Closing a pane (X button or `exit` in shell) kills the session and either collapses the slot or shows an empty pane
- Splitting an existing pane (right-click → "Split Right" / "Split Down") subdivides that cell

---

## Terminal Session Lifecycle

```
1. User clicks "New Terminal" or "+" in empty pane
       │
2. Frontend calls Tauri command: create_session(shell, task_name)
       │
3. Backend: portable_pty spawns new PTY with shell (default: user's $SHELL)
       │
4. Backend: registers Session in registry, starts async read loop
       │
5. Backend: returns session_id to frontend
       │
6. Frontend: creates <TerminalPane> bound to session_id
       │
7. PTY output → Tauri event "session_output:{session_id}" → xterm.js.write()
   User keystrokes → xterm.onData → Tauri command write_to_session → PTY stdin
       │
8. User types "exit" or kills process
       │
9. Backend: detects process exit → emits "session_exit:{session_id}"
       │
10. Frontend: shows "Process exited" in pane, option to restart or close
```

---

## Task Tracking

### Phase 1 — Manual Labeling (MVP)

- When spawning a terminal, the user provides a **task name** (e.g., "Backend API refactor")
- The task name displays in the pane's title bar
- Status is inferred from process state:
  - Green dot = process running
  - Yellow dot = process idle (no output for 30s+)
  - Red dot = process exited with non-zero code
  - Gray dot = process exited cleanly

### Phase 2 — Output Parsing

- The Rust backend inspects PTY output for known patterns:
  - Claude CLI: detect thinking/writing/done states from its output format
  - Generic: detect common error patterns (`Error:`, `FAIL`, `panic`, stack traces)
  - Detect command prompts (e.g., `$` or `>`) to infer "idle" state
- Task status updates are emitted as Tauri events and reflected in the UI

### Phase 3 — Orchestration

- "Spawn Task" command: user types a goal in natural language, app opens a pane and runs `claude "goal here"` automatically
- Task dependencies: allow users to define "run task B after task A completes"
- Dashboard view: a non-terminal view showing all tasks as cards with status, output summary, and duration

---

## Zustand Store Shape

```typescript
interface AppState {
  // Sessions
  sessions: Record<string, TerminalSession>;
  createSession: (taskName: string, command?: string) => Promise<string>;
  removeSession: (sessionId: string) => void;
  updateTaskStatus: (sessionId: string, status: TaskStatus) => void;

  // Layout
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
  applyPreset: (preset: LayoutPreset) => void;

  // UI
  maximizedPane: string | null;
  toggleMaximize: (sessionId: string) => void;
  commandPaletteOpen: boolean;
}

interface TerminalSession {
  id: string;
  taskName: string;
  taskDescription?: string;
  status: TaskStatus;
  command?: string;
  createdAt: number;
  exitCode?: number;
}

type TaskStatus = "running" | "idle" | "errored" | "completed";
type LayoutPreset = "single" | "split-h" | "split-v" | "quad" | "three-col" | "three-row" | "grid-3x3" | "main-side";
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New terminal pane |
| `Cmd+T` | New task (prompt for command + name) |
| `Cmd+W` | Close current pane |
| `Cmd+Shift+Enter` | Toggle maximize current pane |
| `Cmd+K` | Open command palette |
| `Cmd+1-9` | Focus pane by index |
| `Cmd+Arrow` | Navigate between panes directionally |
| `Cmd+D` | Split current pane right |
| `Cmd+Shift+D` | Split current pane down |
| `Cmd+Shift+L` | Open layout preset picker |

---

## File Structure

```
vibe-terminal/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                  // Tauri app entry point
│       ├── pty_manager.rs           // PTY spawning, read/write, resize
│       ├── session.rs               // Session and TaskMetadata types
│       ├── session_registry.rs      // HashMap<SessionId, Session>, CRUD ops
│       ├── commands.rs              // Tauri command handlers (IPC API)
│       └── output_parser.rs         // (Phase 2) Pattern matching on PTY output
│
├── src/
│   ├── main.tsx                     // React entry point
│   ├── App.tsx                      // Root component
│   ├── components/
│   │   ├── TopBar.tsx               // Layout presets, new terminal button
│   │   ├── StatusBar.tsx            // Session count, system info
│   │   ├── GridContainer.tsx        // Layout engine using react-resizable-panels
│   │   ├── TerminalPane.tsx         // xterm.js wrapper + task label bar
│   │   ├── EmptyPane.tsx            // "+" placeholder for empty grid slots
│   │   ├── CommandPalette.tsx       // Cmd+K modal
│   │   └── TaskLabel.tsx            // Task name + status dot in pane header
│   ├── hooks/
│   │   ├── useTerminal.ts           // xterm.js lifecycle, fit, IPC binding
│   │   ├── useSession.ts            // create/kill/list sessions via Tauri
│   │   └── useLayout.ts            // Layout preset logic
│   ├── store/
│   │   └── index.ts                 // Zustand store definition
│   ├── lib/
│   │   ├── tauri.ts                 // Typed wrappers around Tauri invoke/listen
│   │   └── layouts.ts               // Layout preset definitions
│   └── styles/
│       └── globals.css              // Tailwind imports, xterm theme overrides
│
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

---

## MVP Scope (Phase 1)

Build and ship these features first:

1. Spawn a terminal pane backed by a real PTY (user's default shell)
2. Layout presets: single, split-h, split-v, quad
3. Drag-to-resize between panes
4. Task labeling: name each pane when spawning, show in title bar
5. Status dots based on process state (running / idle / exited)
6. Maximize/restore a single pane
7. Keyboard shortcuts for navigation and pane management
8. Close pane / kill session

### Non-Goals for MVP

- Output parsing for AI agent status (Phase 2)
- Task orchestration / dependency chains (Phase 3)
- Saved/custom layout presets
- Tabs within panes
- Remote SSH sessions
- Plugin system

---

## Future Considerations

- **Theming**: dark/light mode, custom color schemes for xterm.js
- **Session persistence**: save/restore open sessions across app restarts
- **Tab support within panes**: multiple sessions per pane, switchable via tabs
- **Git integration**: show current branch per pane, detect which repo each terminal is in
- **AI agent protocol**: a standardized way for AI CLIs to report structured status (thinking, writing, tool use) that the terminal can parse
- **Shared context**: ability to pipe output from one pane into another or share file context between agents
