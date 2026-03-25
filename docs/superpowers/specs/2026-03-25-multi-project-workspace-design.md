# Phase 3: Multi-Project Workspace — Design Spec

## Overview

Quarterdeck currently operates as a single-project IDE. Phase 3 adds multi-project workspace support — the ability to work across multiple codebases simultaneously, switch between them without losing context, and keep background agents running while you work elsewhere.

**Primary interaction model**: project-as-workspace. Switching projects swaps the entire layout (tiling tree, editor tabs, terminal positions). Mixed-project panels (pinning a panel from another project into the current layout) are deferred to a future phase.

## Architecture

### Layout Save/Restore (Approach A+C Hybrid)

Only one project's layout is rendered in the DOM at a time. On project switch:

1. **Save**: serialize the current tiling tree, editor tab state (cursor positions, scroll offsets), and terminal positions. Dispose xterm.js instances.
2. **Background terminals**: move WebSocket connections into `backgroundTerminalStore`. The WS stays open; output is buffered into a ring buffer. Activity is tracked.
3. **Restore**: deserialize the target project's layout, rebuild the tiling tree, reopen editor tabs. For terminals: create xterm.js instances with `visibility: hidden`, drain the ring buffer, flip visible once rendering is complete.

This keeps the DOM clean (no hidden Monaco instances eating memory) while preserving terminal continuity (agents keep running, output is captured).

### New Store: backgroundTerminalStore

Separate Zustand store for managing detached terminal WebSocket connections. The project store calls into it during `switchProject()` but does not own the WebSocket lifecycle.

```typescript
interface BackgroundTerminal {
  sessionId: string;
  projectId: number;
  wsConnection: WebSocket;
  outputBuffer: RingBuffer<Uint8Array>;  // capped at 5000 chunks (raw byte arrays, not lines)
  hasNewOutput: boolean;
  lastOutputTimestamp: number;
  exitInfo: { code: number; command: string } | null;
}

interface BackgroundTerminalStore {
  terminals: Map<string, BackgroundTerminal>;

  detach(sessionId: string, projectId: number, ws: WebSocket): void;
  reattach(sessionId: string): { ws: WebSocket; buffer: Uint8Array[] };

  getByProject(projectId: number): BackgroundTerminal[];
  hasNewOutput(projectId: number): boolean;
  getProjectOutputTimestamp(projectId: number): number | null;

  removeSession(sessionId: string): void;
  removeByProject(projectId: number): void;
}
```

The output buffer uses a ring buffer (fixed-size circular array) to avoid O(n) shifts on a capped plain array. Default cap: 5000 chunks (raw byte arrays from the WebSocket, not lines — terminal output is not line-delimited).

### Store Changes

**projectStore** — adds:
- `projectLayouts: Map<number, ProjectLayout>` — in-memory layout cache
- `projectBranches: Map<number, string>` — cached git branches
- `saveCurrentLayout()` — snapshots layout, editor, and terminal state
- `restoreLayout(projectId)` — replaces current store state with saved snapshot
- `switchProject(projectId)` — orchestrates: save current → detach terminals → restore target (or create default) → reattach terminals
- `updateProject(id, fields)` — for rename, settings updates

**layoutStore** — no structural changes. `root` is replaced wholesale on project switch.

**editorStore** — no structural changes. `openFiles` is replaced wholesale on project switch.

**terminalStore** — adds `projectId` per session for tracking ownership.

## Data Model

### SQLite Schema Changes

New migration `002_multi_project.sql`:

```sql
ALTER TABLE layouts ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_layouts_project ON layouts(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN color TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;
```

`layouts.layout_json` stores the serialized `ProjectLayout`:

```typescript
interface ProjectLayout {
  projectId: number;
  tilingTree: LayoutNode;
  editorTabs: EditorTabSnapshot[];
  activeEditorTab: string | null;
  terminalPositions: TerminalPositionSnapshot[];
}

interface EditorTabSnapshot {
  paneId: string;
  filePath: string;
  cursorPosition: { line: number; column: number };
  scrollPosition: number;
  dirtyContent: string | null;  // unsaved content preserved across switches
}

interface TerminalPositionSnapshot {
  sessionId: string;
  paneId: string;
  tabIndex: number;
}
```

`projects.color` defaults to `NULL`. The frontend auto-assigns from a palette: `palette[sort_order % palette.length]`. Color is only written to the DB if the user explicitly overrides it.

### Project Color Palette

```typescript
const PROJECT_COLORS = [
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#34d399', // green
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#facc15', // yellow
  '#f87171', // red
  '#2dd4bf', // teal
  '#a3e635', // lime
];
```

## Features

### 1. Project CRUD UI

**Add Project dialog:**
- Triggered by `+ Add` button in sidebar or `Ctrl+Shift+O`
- Minimal modal with two fields: directory path (with "Browse" button using `runtime.OpenDirectoryDialog()`) and name (auto-filled from directory basename, editable)
- On confirm: insert into SQLite, add to sidebar, optionally switch to it

**Remove Project:**
- Right-click context menu on sidebar project entry → "Remove"
- Confirmation dialog: "Remove from Quarterdeck? Files won't be deleted."
- Deletes from SQLite (cascades to layouts), cleans up background terminals for that project
- If active project: switch to next available or show empty state

**Rename Project:**
- Right-click → "Rename"
- Inline edit: project name becomes an input field, Enter confirms, Escape cancels
- Updates SQLite

**Project Settings:**
- Right-click → "Settings"
- Opens a settings tab in the main editor area with fields: name (editable), path (read-only), git default branch, dev server URL, dev server command, default agent type, notes

### 2. Per-Project Terminal Context

- `CreateTerminal(projectId int)` looks up the project path from SQLite, sets `cmd.Dir` on the PTY process
- Terminal tab titles show the project context
- PTY session records in `pty_sessions` table get `project_id` populated
- `terminalStore` tracks `projectId` per session

**Go backend change:**
```go
func (a *App) CreateTerminal(projectId int64, cols, rows int) (string, error) {
    project, err := a.projectService.Get(projectId)
    if err != nil {
        return "", err
    }
    return a.ptyManager.Create(shell, project.Path, cols, rows)
}
```

**New backend method needed:**
```go
func (s *Service) Update(id int64, fields UpdateFields) error
// UpdateFields: Name, GitDefaultBranch, DevServerURL, DevServerCommand,
//               DefaultAgentType, Notes, SortOrder, Color
```
Exposed via Wails binding as `App.UpdateProject(id int64, fields UpdateFields) error`.

### 3. Sidebar Improvements

**Git branch display:**
- Reuse existing `GetGitBranch()` backend call
- Poll every 15 seconds for all projects (single interval, not per-project)
- Cached in `projectStore.projectBranches`

**Visual per project entry:**
- 3px left color border (from palette or DB override)
- Project name (bold if active)
- Activity dot next to name: yellow (new output, bright if < 30s, dimmer if older), gray (all terminals exited), none (no background terminals or active project)
- Sub-info line: git branch + terminal count (e.g., `main  2 terms`)

**Drag to reorder:**
- Native HTML drag events on project entries
- On drop: update `sort_order` for affected projects, persist to SQLite

**File tree label:**
- Shows "Files — {project name}" above the file tree to clarify context

### 4. Per-Project Layout Memory

**Save (on switch-away or periodic auto-save):**
1. Serialize `layoutStore.root` (tiling tree)
2. For each editor tab: capture `filePath`, cursor position from Monaco `getPosition()`, scroll position from `getScrollTop()`
3. For each terminal: capture `sessionId`, `paneId`, `tabIndex`
4. Store in `projectLayouts` map
5. Upsert to SQLite `layouts` table (`layout_json` keyed by `project_id`)

**Restore (on switch-to):**
1. Load `ProjectLayout` from map (or SQLite on app startup)
2. Replace `layoutStore.root` with saved tiling tree
3. Reopen editor files: call `ReadFile` for each, set content in editorStore, after Monaco mounts restore cursor and scroll positions
4. For each terminal position:
   - Check `backgroundTerminalStore` for the sessionId
   - **Alive**: create xterm.js with `visibility: hidden`, feed ring buffer, swap WS handlers back, flip visible
   - **Exited**: render "[session ended — exit N] {command}" with a Restart button
   - **Missing** (session ID not found): spawn a new terminal in that position

**First-time project (no saved layout):**
- Create default layout: horizontal split, editor (60%) + terminal (40%)
- Spawn a PTY in the project's directory

**App startup:**
- Load all `ProjectLayout` records from SQLite into `projectLayouts` map
- Restore the last active project's layout

### 5. Project Switcher Overlay

- **Trigger**: `Ctrl+Shift+P`
- **UI**: centered modal over dimmed backdrop, text input at top, project list below
- **Each row**: project color dot, name (fuzzy match highlights in blue), activity dot, path (abbreviated with ~), git branch, terminal count
- **Sorting**: MRU (most recently used) before typing; fuzzy score after typing
- **Navigation**: arrow keys up/down, Enter to switch, Escape to dismiss
- **Footer**: keyboard hint bar (Up/Down navigate, Enter switch, Esc dismiss)
- **Implementation**: purely frontend React component + Zustand store for open/close state
- **Fuzzy matching**: simple score-based filter — match characters in order, bonus for adjacency and start-of-word matches. No external library needed.

### 6. Project-Scoped File Search

- **Trigger**: `Ctrl+P`
- **Scope**: active project only
- **Backend**: `ListProjectFiles(projectId int64) ([]string, error)` — tries `git ls-files` first, falls back to directory walk with same filters as file tree
- **Frontend**: same overlay pattern as project switcher — centered modal, fuzzy search, keyboard navigation
- **Each row**: file icon (extension-based, reuse from FileNode), relative path with fuzzy highlights
- **Enter**: opens file as editor tab
- **Caching**: file list cached per project, invalidated on file save or after 60 seconds
- **Mutual exclusion**: opening file search closes project switcher and vice versa

## Keyboard Shortcuts (New)

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+O` | Add Project dialog |
| `Ctrl+Shift+P` | Project switcher overlay |
| `Ctrl+P` | File search overlay (active project) |

Existing shortcuts unchanged.

## Terminal Exit Handling

When a PTY session exits while in the background (or foreground):
- The terminal pane shows: `[session ended — exit {code}] {command}` centered in the terminal area
- Below it: a "Restart" button that spawns a new PTY in the same pane position with the project's working directory
- The tab remains in place — the user can close it manually or restart

## Implementation Order

1. **Project CRUD UI** — modal, context menu, inline rename. Foundation for everything else.
2. **Per-project terminal context** — wire project path into PTY creation. Simple Go-side change.
3. **Sidebar improvements** — color borders, git branch polling, terminal count, activity dots, drag reorder.
4. **Per-project layout memory** — save/restore on project switch. The big one.
5. **Background terminal store** — ring buffer, WS lifecycle, activity tracking. Tightly coupled with #4.
6. **Project switcher overlay** — fuzzy search, keyboard navigation.
7. **File search overlay** — same pattern as #6, scoped to active project.

Steps 4 and 5 should be implemented together as they're interdependent.

## Edge Cases

**Rapid project switching:** `switchProject()` is guarded by a mutex (or a simple `isSwitching` flag). If a switch is in progress, subsequent calls are queued or ignored until the current switch completes. This prevents half-initialized layouts from being saved.

**Deleted project directories:** On app startup and on project switch, check that the project's `path` exists on disk. If missing:
- Show a warning badge on the sidebar entry (e.g., a caution icon)
- Disable "switch to" — clicking shows a message: "Directory not found: {path}"
- Allow "Remove" from the context menu to clean up

**Unsaved editor changes:** When saving a layout snapshot, if any editor tab has `modified: true`, the dirty content is preserved in `EditorTabSnapshot.dirtyContent`. On restore, the dirty content is loaded into Monaco instead of reading from disk, and the file is marked as modified. No data loss occurs.

**Pre-existing layout rows:** Any rows in the `layouts` table with `project_id IS NULL` (from Phase 1-2 schema) are ignored by the new code. They remain in the DB but are not loaded. They can be cleaned up by a future migration.

**Layout ID collisions:** The `layoutStore.nextId` counter uses sequential IDs (`pane-1`, `pane-2`). When restoring a serialized layout tree, `nextId` is set to `max(all numeric IDs in the restored tree) + 1` to avoid collisions with new panes created after restore.

**Auto-save:** Layout state is auto-saved to SQLite every 60 seconds (debounced — only writes if state changed since last save). This limits data loss on app crash to at most 60 seconds of layout changes.

**`List()` ordering:** The Go `project.Service.List()` query is updated to `ORDER BY sort_order, name` so drag-to-reorder persists across app restarts.

## Technical Notes

- All Go backend code gets tests (TDD approach from Phase 1-2)
- No frontend tests (consistent with existing codebase)
- Ring buffer: ~30 lines of TypeScript, fixed-size circular array
- Git branch polling: single 15-second interval for all projects, `git rev-parse --abbrev-ref HEAD`
- Fuzzy matching: custom implementation, ~50 lines, no external library
- Native directory picker: `runtime.OpenDirectoryDialog()` uses GTK file chooser on Linux (integrates with i3)
- `Ctrl+P` / `Ctrl+Shift+P` mirrors VS Code conventions intentionally
