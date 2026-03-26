# Phase 4a: Agent Management Core — Design Spec

## Overview

Quarterdeck currently treats all terminals equally. Phase 4a makes agents a first-class concept — Quarterdeck understands that certain terminals are running AI coding agents, tracks their lifecycle, detects their state, and surfaces that information in the UI so users know when an agent needs attention.

**Scope (Phase 4a):** Agent registry & data model, spawn dialog, state detection, agent sidebar. Desktop notifications, git-based run tracking, status bar integration, and sidebar indicator upgrades are deferred to Phase 4b.

## Architecture

### State Detection: Hybrid Timing + Regex (Approach A Tee)

The PTY output already flows from Go backend through WebSocket to the frontend. We add a single `detector.Feed(data)` call in the existing WS handler's PTY read loop — one extra function call per read chunk. The detector runs in the Go backend so it works even when the terminal isn't rendered (background projects).

**Detection layers:**
1. **Timing heuristics (universal):** output flowing = working, no output for 5 seconds after a burst = idle/needs_input, process exit = done/error. Works for all agent types including custom.
2. **Regex patterns (per agent type):** optional overlay that refines the timing heuristic. ANSI escape sequences are stripped before matching. Regex failures degrade gracefully to timing-only.
3. **Process exit (authoritative):** exit code 0 = done, non-zero = error. Overrides all other detection.

State transitions are debounced by 500ms to avoid flickering from intermediate rendering.

### Event Broadcasting

A new WebSocket route `/ws/events` provides a persistent connection for the frontend to receive agent status changes. Events are JSON:

```json
{"type": "agent_status", "agentId": "abc-123", "status": "needs_input"}
{"type": "agent_status", "agentId": "abc-123", "status": "done", "exitCode": 0}
```

The agent manager pushes events through this channel whenever a detector confirms a state change.

## Data Model

### SQLite Changes

New migration `003_agent_management.sql`:

```sql
ALTER TABLE agent_runs ADD COLUMN agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
```

The existing `agent_runs` table already has: `project_id`, `agent_type`, `task_description`, `base_commit`, `end_commit`, `status`, `started_at`, `completed_at`, `pty_scrollback`. We add `agent_id` to link live agents to their run records.

### Go Types

```go
// internal/agent/agent.go
type AgentStatus string
const (
    AgentStatusStarting   AgentStatus = "starting"
    AgentStatusWorking    AgentStatus = "working"
    AgentStatusNeedsInput AgentStatus = "needs_input"
    AgentStatusDone       AgentStatus = "done"
    AgentStatusError      AgentStatus = "error"
)

type Agent struct {
    ID           string      `json:"id"`
    RunID        int64       `json:"runId"`
    ProjectID    int64       `json:"projectId"`
    Type         string      `json:"type"`
    DisplayName  string      `json:"displayName"`
    Command      string      `json:"command"`
    Status       AgentStatus `json:"status"`
    TaskDesc     string      `json:"taskDescription"`
    PTYSessionID string      `json:"ptySessionId"`
    StartedAt    time.Time   `json:"startedAt"`
    ExitCode     *int        `json:"exitCode"`
}

type AgentConfig struct {
    Type        string
    DisplayName string
    Command     string
    Icon        string // 2-char identifier for UI
}
```

### Built-in Agent Configs

```go
var BuiltinAgents = map[string]AgentConfig{
    "claude_code": {Type: "claude_code", DisplayName: "Claude Code", Command: "claude", Icon: "CC"},
    "codex":       {Type: "codex", DisplayName: "Codex", Command: "codex", Icon: "CX"},
    "opencode":    {Type: "opencode", DisplayName: "OpenCode", Command: "opencode", Icon: "OC"},
}
```

Custom agents use the command provided in the spawn dialog.

## Agent Manager

```go
// internal/agent/manager.go
type Manager struct {
    agents    map[string]*Agent
    detectors map[string]*StateDetector  // keyed by PTY session ID
    ptyMgr    *pty.Manager
    store     *db.Store
    mu        sync.RWMutex
    broadcast func(event []byte)  // sends to /ws/events connections
}
```

**Methods:**
- `Spawn(projectID int64, agentType, taskDesc, workDir, customCmd string) (*Agent, error)` — validates command exists (`exec.LookPath`), creates PTY, DB row, detector, spawns exit watcher goroutine, returns agent
- `Get(id string) *Agent`
- `List() []*Agent`
- `ListByProject(projectID int64) []*Agent`
- `Stop(id string) error` — signals PTY to close, cleans up detector
- `GetDetector(ptySessionID string) *StateDetector` — used by WS handler to feed output
- `OnStatusChange(agent *Agent, status AgentStatus)` — called by detector or exit watcher, updates agent + DB + broadcasts
- `OnPTYClosed(ptySessionID string)` — called when a PTY session is closed externally (user closes tab), transitions agent to done/error and cleans up
- `Shutdown()` — stops all agents, finalizes all DB rows, called during app shutdown

**Process exit detection:** On spawn, the manager starts a goroutine per agent that watches `session.Done` channel. When the channel closes, the goroutine reads the exit code and calls `OnStatusChange` with `done` (exit 0) or `error` (non-zero). This is separate from the detector's `Feed` path — it handles the authoritative process exit signal.

**External terminal close:** If the user manually closes an agent's terminal tab, `ptyMgr.Close()` is called which kills the process. The exit watcher goroutine detects this via the `Done` channel and transitions the agent appropriately.

**Project deletion:** When a project is deleted, the app must call `agentMgr.StopByProject(projectID)` before deleting the project to ensure all agents are stopped and DB rows finalized.

## State Detector

```go
// internal/agent/detector.go
type StateDetector struct {
    agentType     string
    patterns      *AgentPatterns
    currentState  AgentStatus
    onChange      func(AgentStatus)

    buffer        []byte    // rolling buffer, last 4096 bytes
    bufSize       int       // 4096

    lastOutputAt  time.Time
    idleTimeout   time.Duration // 5 seconds
    idleTimer     *time.Timer
    debounce      time.Duration // 500ms
    debounceTimer *time.Timer
    stagedState   *AgentStatus  // pending state change waiting for debounce
    mu            sync.Mutex
}
```

### Feed Flow

On `Feed(data []byte)`:
1. Append to rolling buffer, trim to `bufSize`
2. Reset idle timer (output is arriving)
3. If `currentState` is not `working`, transition to `working`
4. Strip ANSI from buffer copy
5. Run regex patterns against stripped text (if available for agent type)
6. If pattern matches a new state, stage it with debounce timer
7. If debounce timer fires, confirm the transition via `onChange`

On idle timer fire (5s no output):
- If no staged regex match: stage `needs_input`
- Debounce applies here too

On process exit (detected via PTY session's Done channel):
- Cancel all timers
- Set `done` (exit 0) or `error` (non-zero) immediately, no debounce

### ANSI Stripping

Simple regex removal before pattern matching:

```go
var ansiRegex = regexp.MustCompile(`\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b\].*?\x07|\x1b[()][AB012]`)

func stripANSI(data []byte) []byte {
    return ansiRegex.ReplaceAll(data, nil)
}
```

This handles CSI sequences (colors, cursor positioning, private modes like `?25h`), OSC sequences (title setting), and charset designations. The character class `[\x30-\x3f]` covers digits, semicolons, and `?` (for private mode sequences like cursor show/hide and alternate screen buffer). It doesn't handle every possible escape sequence but covers 95%+ of what agent CLIs emit. The timing heuristic handles the rest.

### Pattern Definitions

```go
// internal/agent/patterns.go
type AgentPatterns struct {
    NeedsInput []*regexp.Regexp
    Done       []*regexp.Regexp
    Error      []*regexp.Regexp
}

func PatternsForAgent(agentType string) *AgentPatterns
```

**Claude Code:**
- NeedsInput: `❯\s*$`, `\(Y/n\)`, `\(y/N\)`, `Do you want to`
- Done: (exit code only)
- Error: `Error:`, `error:`

**Codex:**
- NeedsInput: `Apply these changes\?`, `\(Y/n\)`, `\[y/N\]`
- Done: `Changes applied`
- Error: `Error`, `Failed`

**OpenCode:**
- NeedsInput: `\(Y/n\)`, `\(y/N\)`
- Done: (exit code only)
- Error: `error:`, `Error:`

**Custom:** `nil` — timing heuristics only.

### Integration Point

In `ws/handler.go`, after the PTY read:

```go
n, err := session.Read(buf)
if n > 0 {
    // Existing: send to WebSocket
    conn.WriteMessage(websocket.BinaryMessage, buf[:n])

    // New: feed to agent detector (if this is an agent terminal)
    if detector := agentMgr.GetDetector(sessionID); detector != nil {
        detector.Feed(buf[:n])
    }
}
```

## Spawn Flow

### Spawn Dialog (Frontend)

Triggered by `Ctrl+Shift+A` or "+ New" button in agents sidebar section.

**Modal contents:**
- Agent type: radio group — Claude Code, Codex, OpenCode, Custom (with command text field)
- Task description: textarea (optional)
- Project: dropdown, defaults to active project
- Working directory: text field, defaults to project root
- Launch button

### Spawn Sequence (Backend)

`App.SpawnAgent(projectID, agentType, taskDesc, workDir, customCmd)`:

1. Resolve command from `BuiltinAgents` or `customCmd`
2. **Validate command exists** via `exec.LookPath(command)`. If not found, return a user-facing error immediately — do not create DB rows or PTY sessions.
3. Build args — for `claude_code` with a task: `["-p", taskDesc]` (the `-p` flag passes a prompt to Claude Code in interactive mode). If task is empty, launch with no args (interactive mode). Other agents: bare command, user types in terminal.
4. Capture `git rev-parse HEAD` in workDir (skip if not a git repo — set `base_commit` to empty string)
5. Create PTY session via `ptyMgr.Create(command, args, workDir, 120, 30)` — **note:** `pty.Manager.Create` and `newSession` must be extended to accept `args []string` in addition to the shell/command string. Currently they only accept a single shell string.
6. Create `agent_runs` row with status "starting" (after PTY succeeds — avoids orphaned rows on PTY failure)
7. Create agent record in manager
8. Create state detector, register by PTY session ID
9. Start exit watcher goroutine for this agent's PTY session
10. Return `{AgentID, PTYSessionID}` to frontend

### Frontend Post-Spawn

1. Add agent to `agentStore`
2. Create terminal tab in focused pane, wired to PTY session ID
3. Tab title: agent icon + truncated task description

## Agent Sidebar

### Layout

Collapsible "AGENTS" section between project list and file tree in the sidebar.

**Collapsed:** one-line summary — "2 agents (1 needs input)" with color.

**Expanded:** list of agent cards, one per running/recent agent.

### Agent Card

Each card shows:
- Agent type icon (CC, CX, OC, or first 2 chars of custom command)
- Status indicator: colored dot + text
  - Starting: blue "Starting"
  - Working: green "Working"
  - Needs Input: yellow "Input" (attention styling)
  - Done: green checkmark "Done"
  - Error: red "Error"
- Elapsed time since start (e.g., "2m", "1h 5m")
- Task description (truncated ~30 chars, full on hover)
- Project name with project color dot

### Interactions

- **Click** card → switch to agent's project + focus agent's terminal tab
- **Right-click** → context menu: "Stop Agent"
- **"+ New" button** in section header → opens spawn dialog

### Attention Styling

`needs_input` cards get yellow left border + brighter background. `error` cards get red. These visually pop — the user should notice them without looking for them.

## Frontend Store

```typescript
// stores/agentStore.ts
interface AgentState {
  id: string;
  projectId: number;
  type: string;
  displayName: string;
  taskDescription: string;
  status: 'starting' | 'working' | 'needs_input' | 'done' | 'error';
  ptySessionId: string;
  startedAt: string;
  exitCode: number | null;
}

interface AgentStoreState {
  agents: Map<string, AgentState>;

  addAgent: (agent: AgentState) => void;
  updateStatus: (agentId: string, status: string, exitCode?: number) => void;
  removeAgent: (agentId: string) => void;

  getProjectAgents: (projectId: number) => AgentState[];
  getActiveAgents: () => AgentState[];
  getAttentionAgents: () => AgentState[];
}
```

### Event Listener

A persistent WebSocket connection to `/ws/events` in `App.tsx`. On `agent_status` messages, calls `agentStore.updateStatus()`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Open agent spawn dialog |

## Backend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/agent/agent.go` | Create | Agent type, AgentStatus, AgentConfig, BuiltinAgents |
| `internal/agent/manager.go` | Create | Agent lifecycle: Spawn, Stop, List, status updates |
| `internal/agent/detector.go` | Create | State detection: Feed, timing, regex matching |
| `internal/agent/patterns.go` | Create | Per-agent-type regex patterns, ANSI stripping |
| `internal/agent/manager_test.go` | Create | Manager tests |
| `internal/agent/detector_test.go` | Create | Detector tests with simulated output |
| `internal/db/migrations/003_agent_management.sql` | Create | Add agent_id column |
| `internal/ws/handler.go` | Modify | Add detector.Feed() call in PTY read loop |
| `internal/ws/events.go` | Create | /ws/events handler for broadcasting agent status |
| `internal/ws/server.go` | Modify | Accept agent manager, register /ws/events route |
| `internal/pty/manager.go` | Modify | Extend Create/newSession to accept args []string |
| `internal/pty/session.go` | Modify | Pass args to exec.Command |
| `app.go` | Modify | Add agent manager init, shutdown, Wails bindings |

## Frontend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/stores/agentStore.ts` | Create | Agent state management |
| `frontend/src/components/sidebar/AgentSection.tsx` | Create | Collapsible agents section |
| `frontend/src/components/sidebar/AgentCard.tsx` | Create | Individual agent card |
| `frontend/src/components/sidebar/SpawnAgentModal.tsx` | Create | Agent spawn dialog |
| `frontend/src/components/sidebar/Sidebar.tsx` | Modify | Add AgentSection between projects and file tree |
| `frontend/src/hooks/useAgentEvents.ts` | Create | WebSocket /ws/events listener |
| `frontend/src/App.tsx` | Modify | Add Ctrl+Shift+A shortcut, agent event listener |
| `frontend/src/lib/types.ts` | Modify | Add agent-related types |

## Edge Cases

**Command not found:** `exec.LookPath` is called before any PTY or DB work. If the command is not on PATH, the spawn returns an error to the frontend which displays it in the dialog. No cleanup needed.

**Multiple agents on same project:** Allowed with no limit. Each gets its own terminal tab. Click on agent card focuses that agent's tab; if the project is already active, it just switches to the tab without a full project switch.

**Agent terminal closed manually:** User closes the terminal tab → `ptyMgr.Close()` kills the process → exit watcher goroutine fires → agent transitions to `done`/`error` → sidebar updates. The agent card persists with its final state.

**Project deleted with running agents:** `deleteProject` calls `agentMgr.StopByProject(projectID)` first, which stops all agents for that project, finalizes their DB rows, then the project deletion cascades to `agent_runs` rows.

**Status value compatibility:** The existing `agent_runs.status` column defaults to `'running'`. New code uses `starting`, `working`, `needs_input`, `done`, `error`. Pre-existing rows with `'running'` are legacy and ignored by the agent manager (which only manages live agents). Historical queries should treat `'running'` as equivalent to `'working'`.

**App shutdown:** `app.go`'s `shutdown()` calls `agentMgr.Shutdown()` before `ptyMgr.CloseAll()`. Shutdown finalizes all agent DB rows with their current status and cancels all detector timers.

**Rolling buffer boundary splits:** If a regex pattern spans two `Feed()` calls at the buffer boundary, the match may be missed. This is an accepted limitation — the timing heuristic covers the gap. The 4096-byte buffer is large enough that most prompt patterns fit within a single buffer window.

**PTY args support:** `pty.Manager.Create` and `pty.Session` must be extended to accept `args []string`. The existing signature `Create(shell, workDir string, cols, rows uint16)` becomes `Create(command string, args []string, workDir string, cols, rows uint16)`. Existing callers (regular terminals) pass `nil` for args. The session uses `exec.Command(command, args...)` instead of `exec.Command(shell)`.

## Technical Notes

- All Go backend code gets tests. Detector tests use simulated PTY output (byte sequences with ANSI codes) to verify state transitions without running actual agent CLIs.
- The idle timeout (5s) and debounce (500ms) are constants, not configurable for now.
- Agent cards for "done" agents persist in the sidebar until the user closes them or starts a new session. They don't auto-remove.
- The `/ws/events` connection is established once on app startup. If it disconnects, the frontend reconnects with exponential backoff.
- The `claude -p` flag passes the task as a prompt to Claude Code in interactive mode. If the user leaves the task field empty, Claude Code launches in interactive mode with no args.
- Pattern definitions are Go constants. Making them configurable via JSON file is deferred to Phase 4b or later.
- The WS handler needs access to the agent manager for `GetDetector()`. `ws.NewServer` is extended to accept the agent manager (or a `DetectorLookup` interface) alongside the PTY manager.
