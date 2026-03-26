# Agent Management Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quarterdeck agent-aware — spawn AI coding agents, detect their state via PTY output analysis, and surface status in the sidebar so users know when agents need attention.

**Architecture:** Agent manager in Go backend owns the lifecycle (spawn, detect, stop). State detector tees PTY output in the WS handler, uses hybrid timing+regex to determine agent state. Status changes broadcast via `/ws/events` WebSocket to the frontend agent store, which drives the sidebar UI.

**Tech Stack:** Go 1.25, Wails v2, SQLite, React 18, Zustand, xterm.js, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-agent-management-design.md`

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/db/migrations/003_agent_management.sql` | Create | Add `agent_id` column to `agent_runs` |
| `internal/pty/session.go` | Modify | Accept `args []string` in `newSession` |
| `internal/pty/manager.go` | Modify | Update `Create` signature to accept `args []string` |
| `internal/pty/manager_test.go` | Modify | Update test for new signature |
| `internal/agent/agent.go` | Create | Agent, AgentStatus, AgentConfig types, BuiltinAgents registry |
| `internal/agent/patterns.go` | Create | AgentPatterns, ANSI stripping, per-agent-type regex patterns |
| `internal/agent/detector.go` | Create | StateDetector with Feed, timing heuristics, debounce |
| `internal/agent/detector_test.go` | Create | Detector tests with simulated PTY output |
| `internal/agent/manager.go` | Create | Agent lifecycle: Spawn, Stop, List, exit watcher, status broadcast |
| `internal/agent/manager_test.go` | Create | Manager spawn/stop tests |
| `internal/ws/events.go` | Create | EventHub for `/ws/events` broadcast connections |
| `internal/ws/server.go` | Modify | Accept agent manager, register `/ws/events` route |
| `internal/ws/handler.go` | Modify | Add `detector.Feed()` in PTY read loop |
| `app.go` | Modify | Init agent manager, shutdown, Wails bindings |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add `AgentState`, `SpawnResult` types |
| `frontend/src/stores/agentStore.ts` | Create | Agent state management with Zustand |
| `frontend/src/hooks/useAgentEvents.ts` | Create | WebSocket `/ws/events` listener |
| `frontend/src/components/sidebar/SpawnAgentModal.tsx` | Create | Agent spawn dialog |
| `frontend/src/components/sidebar/AgentCard.tsx` | Create | Individual agent status card |
| `frontend/src/components/sidebar/AgentSection.tsx` | Create | Collapsible agents section for sidebar |
| `frontend/src/components/sidebar/Sidebar.tsx` | Modify | Insert AgentSection between projects and file tree |
| `frontend/src/App.tsx` | Modify | Add `Ctrl+Shift+A` shortcut, agent events hook |

---

## Task 1: SQLite Migration & PTY Args Support

**Files:**
- Create: `internal/db/migrations/003_agent_management.sql`
- Modify: `internal/pty/session.go`
- Modify: `internal/pty/manager.go`
- Modify: `internal/pty/manager_test.go`
- Modify: `app.go`

- [ ] **Step 1: Create the migration file**

Create `internal/db/migrations/003_agent_management.sql`:

```sql
ALTER TABLE agent_runs ADD COLUMN agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
```

- [ ] **Step 2: Verify migration is idempotent**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/db/ -v -run TestMigrateIdempotent`
Expected: PASS (the migration runner tracks applied migrations)

- [ ] **Step 3: Update PTY session to accept args**

In `internal/pty/session.go`, change `newSession` signature from:
```go
func newSession(id, shell, workDir string, cols, rows uint16) (*Session, error) {
    cmd := exec.Command(shell)
```

To:
```go
func newSession(id, command string, args []string, workDir string, cols, rows uint16) (*Session, error) {
    cmd := exec.Command(command, args...)
```

- [ ] **Step 4: Update PTY manager to pass args**

In `internal/pty/manager.go`, change `Create` signature from:
```go
func (m *Manager) Create(shell, workDir string, cols, rows uint16) (string, error) {
    // ...
    sess, err := newSession(id, shell, workDir, cols, rows)
```

To:
```go
func (m *Manager) Create(command string, args []string, workDir string, cols, rows uint16) (string, error) {
    // ...
    sess, err := newSession(id, command, args, workDir, cols, rows)
```

- [ ] **Step 5: Update existing callers**

In `app.go`, update `CreateTerminal` to pass `nil` for args:
```go
func (a *App) CreateTerminal(workDir string, cols, rows int) (string, error) {
    shell := os.Getenv("SHELL")
    if shell == "" {
        shell = "/bin/sh"
    }
    return a.ptyMgr.Create(shell, nil, workDir, uint16(cols), uint16(rows))
}
```

- [ ] **Step 6: Update PTY tests**

In `internal/pty/manager_test.go`, update any `Create` calls to include `nil` as the args parameter.

- [ ] **Step 7: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add internal/db/migrations/003_agent_management.sql internal/pty/ app.go
git commit -m "feat: agent_id migration, PTY args support for agent commands"
```

---

## Task 2: Agent Types & Pattern Definitions

**Files:**
- Create: `internal/agent/agent.go`
- Create: `internal/agent/patterns.go`

- [ ] **Step 1: Create agent types**

Create `internal/agent/agent.go`:

```go
package agent

import "time"

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
	Icon        string
}

var BuiltinAgents = map[string]AgentConfig{
	"claude_code": {Type: "claude_code", DisplayName: "Claude Code", Command: "claude", Icon: "CC"},
	"codex":       {Type: "codex", DisplayName: "Codex", Command: "codex", Icon: "CX"},
	"opencode":    {Type: "opencode", DisplayName: "OpenCode", Command: "opencode", Icon: "OC"},
}

type SpawnResult struct {
	AgentID      string `json:"agentId"`
	PTYSessionID string `json:"ptySessionId"`
}
```

- [ ] **Step 2: Create pattern definitions with ANSI stripping**

Create `internal/agent/patterns.go`:

```go
package agent

import "regexp"

var ansiRegex = regexp.MustCompile(`\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b\].*?\x07|\x1b[()][AB012]`)

func StripANSI(data []byte) []byte {
	return ansiRegex.ReplaceAll(data, nil)
}

type AgentPatterns struct {
	NeedsInput []*regexp.Regexp
	Done       []*regexp.Regexp
	Error      []*regexp.Regexp
}

func PatternsForAgent(agentType string) *AgentPatterns {
	switch agentType {
	case "claude_code":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`❯\s*$`),
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\(y/N\)`),
				regexp.MustCompile(`Do you want to`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^Error:`),
			},
		}
	case "codex":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`Apply these changes\?`),
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\[y/N\]`),
			},
			Done: []*regexp.Regexp{
				regexp.MustCompile(`Changes applied`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^Error`),
				regexp.MustCompile(`(?i)^Failed`),
			},
		}
	case "opencode":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\(y/N\)`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^error:`),
			},
		}
	default:
		return nil // Custom agents: timing heuristics only
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add internal/agent/agent.go internal/agent/patterns.go
git commit -m "feat: agent types, builtin configs, ANSI stripping, pattern definitions"
```

---

## Task 3: State Detector

**Files:**
- Create: `internal/agent/detector.go`
- Create: `internal/agent/detector_test.go`

- [ ] **Step 1: Write failing detector tests**

Create `internal/agent/detector_test.go`:

```go
package agent

import (
	"testing"
	"time"
)

func TestDetectorTransitionsToWorkingOnOutput(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})

	d.Feed([]byte("Thinking about the problem...\n"))
	time.Sleep(10 * time.Millisecond) // let goroutines settle

	if d.CurrentState() != AgentStatusWorking {
		t.Errorf("expected working, got %s", d.CurrentState())
	}
	_ = lastStatus
}

func TestDetectorNeedsInputOnPattern(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})

	d.Feed([]byte("Working on the code...\n"))
	d.Feed([]byte("Do you want to proceed? (Y/n) "))
	// Wait for debounce (500ms) + margin
	time.Sleep(700 * time.Millisecond)

	if lastStatus != AgentStatusNeedsInput {
		t.Errorf("expected needs_input, got %s", lastStatus)
	}
}

func TestDetectorNeedsInputOnIdle(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetectorWithTimeouts("custom", func(s AgentStatus) {
		lastStatus = s
	}, 500*time.Millisecond, 200*time.Millisecond) // short timeouts for testing

	d.Feed([]byte("some output"))
	time.Sleep(900 * time.Millisecond) // > idle + debounce

	if lastStatus != AgentStatusNeedsInput {
		t.Errorf("expected needs_input from idle timeout, got %s", lastStatus)
	}
}

func TestDetectorDoneOnExit(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})

	d.Feed([]byte("Working...\n"))
	exitCode := 0
	d.OnProcessExit(&exitCode)

	if lastStatus != AgentStatusDone {
		t.Errorf("expected done, got %s", lastStatus)
	}
}

func TestDetectorErrorOnNonZeroExit(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})

	d.Feed([]byte("Working...\n"))
	exitCode := 1
	d.OnProcessExit(&exitCode)

	if lastStatus != AgentStatusError {
		t.Errorf("expected error, got %s", lastStatus)
	}
}

func TestStripANSI(t *testing.T) {
	input := []byte("\x1b[32mgreen text\x1b[0m normal \x1b[?25h")
	got := string(StripANSI(input))
	expected := "green text normal "
	if got != expected {
		t.Errorf("StripANSI: expected %q, got %q", expected, got)
	}
}

func TestDetectorDebouncesPreventsFlicker(t *testing.T) {
	var transitions []AgentStatus
	d := NewDetectorWithTimeouts("claude_code", func(s AgentStatus) {
		transitions = append(transitions, s)
	}, 5*time.Second, 300*time.Millisecond)

	// Send needs_input pattern
	d.Feed([]byte("Do you want to proceed? (Y/n) "))
	// Quickly send more output (cancels the debounce)
	time.Sleep(100 * time.Millisecond)
	d.Feed([]byte("Actually, continuing...\n"))

	time.Sleep(500 * time.Millisecond)

	// Should NOT have transitioned to needs_input because output resumed
	for _, s := range transitions {
		if s == AgentStatusNeedsInput {
			t.Error("should not have transitioned to needs_input due to debounce cancel")
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run TestDetector`
Expected: FAIL — `NewDetector` undefined

- [ ] **Step 3: Implement the state detector**

Create `internal/agent/detector.go`:

```go
package agent

import (
	"sync"
	"time"
)

const (
	defaultBufSize     = 4096
	defaultIdleTimeout = 5 * time.Second
	defaultDebounce    = 500 * time.Millisecond
)

type StateDetector struct {
	patterns     *AgentPatterns
	currentState AgentStatus
	onChange     func(AgentStatus)

	buffer  []byte
	bufSize int

	lastOutputAt  time.Time
	idleTimeout   time.Duration
	idleTimer     *time.Timer
	debounce      time.Duration
	debounceTimer *time.Timer
	stagedState   *AgentStatus
	stopped       bool
	mu            sync.Mutex
}

func NewDetector(agentType string, onChange func(AgentStatus)) *StateDetector {
	return NewDetectorWithTimeouts(agentType, onChange, defaultIdleTimeout, defaultDebounce)
}

func NewDetectorWithTimeouts(agentType string, onChange func(AgentStatus), idleTimeout, debounce time.Duration) *StateDetector {
	d := &StateDetector{
		patterns:     PatternsForAgent(agentType),
		currentState: AgentStatusStarting,
		onChange:     onChange,
		buffer:       make([]byte, 0, defaultBufSize),
		bufSize:      defaultBufSize,
		idleTimeout:  idleTimeout,
		debounce:     debounce,
	}
	return d
}

func (d *StateDetector) CurrentState() AgentStatus {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentState
}

func (d *StateDetector) Feed(data []byte) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.stopped {
		return
	}

	// Append to rolling buffer
	d.buffer = append(d.buffer, data...)
	if len(d.buffer) > d.bufSize {
		d.buffer = d.buffer[len(d.buffer)-d.bufSize:]
	}

	d.lastOutputAt = time.Now()

	// Reset idle timer
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	d.idleTimer = time.AfterFunc(d.idleTimeout, d.onIdleTimeout)

	// Transition to working if not already
	if d.currentState != AgentStatusWorking {
		d.currentState = AgentStatusWorking
		d.onChange(AgentStatusWorking)
	}

	// Cancel any staged transition — new output invalidates it
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
		d.stagedState = nil
	}

	// Check regex patterns
	if d.patterns != nil {
		stripped := StripANSI(d.buffer)
		if d.matchAny(d.patterns.NeedsInput, stripped) {
			d.stageTransition(AgentStatusNeedsInput)
		} else if d.matchAny(d.patterns.Done, stripped) {
			d.stageTransition(AgentStatusDone)
		} else if d.matchAny(d.patterns.Error, stripped) {
			d.stageTransition(AgentStatusError)
		}
	}
}

func (d *StateDetector) OnProcessExit(exitCode *int) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.stopped = true

	// Cancel all timers
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
	}

	// Authoritative: process exit determines final state
	if exitCode != nil && *exitCode != 0 {
		d.currentState = AgentStatusError
		d.onChange(AgentStatusError)
	} else {
		d.currentState = AgentStatusDone
		d.onChange(AgentStatusDone)
	}
}

func (d *StateDetector) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.stopped = true
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
	}
}

func (d *StateDetector) stageTransition(state AgentStatus) {
	// Must be called with mu held
	s := state
	d.stagedState = &s
	d.debounceTimer = time.AfterFunc(d.debounce, func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.stopped {
			return
		}
		if d.stagedState != nil && *d.stagedState == state {
			d.currentState = state
			d.stagedState = nil
			d.onChange(state)
		}
	})
}

func (d *StateDetector) onIdleTimeout() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.stopped {
		return
	}

	// If no regex match is staged, assume needs_input
	if d.stagedState == nil {
		d.stageTransition(AgentStatusNeedsInput)
	}
}

func (d *StateDetector) matchAny(patterns []*regexp.Regexp, data []byte) bool {
	for _, p := range patterns {
		if p.Match(data) {
			return true
		}
	}
	return false
}
```

The import block for `detector.go` must include `"regexp"` (used by `matchAny`'s `*regexp.Regexp` parameter).

- [ ] **Step 4: Run detector tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run TestDetector -timeout 30s`
Expected: ALL PASS

Also run: `go test ./internal/agent/ -v -run TestStripANSI`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/agent/detector.go internal/agent/detector_test.go
git commit -m "feat: state detector with hybrid timing + regex, debounce, ANSI stripping"
```

---

## Task 4: WebSocket Event Broadcasting

**Files:**
- Create: `internal/ws/events.go`
- Modify: `internal/ws/server.go`

- [ ] **Step 1: Create EventHub for broadcasting**

Create `internal/ws/events.go`:

```go
package ws

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// EventHub manages persistent WebSocket connections for broadcasting events.
type EventHub struct {
	mu    sync.RWMutex
	conns map[*websocket.Conn]bool
}

func NewEventHub() *EventHub {
	return &EventHub{
		conns: make(map[*websocket.Conn]bool),
	}
}

func (h *EventHub) Add(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[conn] = true
}

func (h *EventHub) Remove(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	conn.Close()
	delete(h.conns, conn)
}

// Broadcast sends a message to all connected event listeners.
// Uses full Lock (not RLock) because gorilla/websocket does not support concurrent writes.
func (h *EventHub) Broadcast(data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.conns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("event broadcast error: %v", err)
		}
	}
}

// HandleEvents is the HTTP handler for /ws/events.
// Note: ensure "net/http" is in the import block for this file.
func (h *EventHub) HandleEvents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("event ws upgrade failed: %v", err)
			return
		}

		h.Add(conn)
		defer h.Remove(conn)

		// Keep connection alive — read loop just drains messages
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
		}
	}
}
```

Add `"net/http"` to imports.

- [ ] **Step 2: Define DetectorLookup interface**

Add to `internal/ws/events.go` (or a separate file, but keeping it simple):

```go
// DetectorLookup allows the WS handler to find detectors without depending on the agent package.
type DetectorLookup interface {
	FeedDetector(ptySessionID string, data []byte)
}
```

- [ ] **Step 3: Update server.go to accept EventHub and DetectorLookup**

Modify `internal/ws/server.go`:

Change `Server` struct to add `eventHub` and `detectorLookup`:
```go
type Server struct {
	hub            *Hub
	eventHub       *EventHub
	ptyMgr         *ptyPkg.Manager
	detectorLookup DetectorLookup
	listener       net.Listener
	port           int
}
```

Change `NewServer` signature:
```go
func NewServer(ptyMgr *ptyPkg.Manager, detectorLookup DetectorLookup) (*Server, error) {
```

Initialize `eventHub` inside:
```go
eventHub := NewEventHub()
```

Register the events route:
```go
mux.HandleFunc("/ws/events", eventHub.HandleEvents())
```

Pass `detectorLookup` to the PTY handler:
```go
mux.HandleFunc("/ws/pty/", HandlePTY(hub, ptyMgr, detectorLookup))
```

Add getter:
```go
func (s *Server) EventHub() *EventHub {
	return s.eventHub
}
```

Store fields:
```go
srv := &Server{
	hub:            hub,
	eventHub:       eventHub,
	ptyMgr:         ptyMgr,
	detectorLookup: detectorLookup,
	listener:       listener,
	port:           port,
}
```

- [ ] **Step 4: Update handler.go to feed detector**

Change `HandlePTY` signature:
```go
func HandlePTY(hub *Hub, ptyMgr *ptyPkg.Manager, detectorLookup DetectorLookup) http.HandlerFunc {
```

In the PTY→WS read loop, after `conn.WriteMessage`:
```go
if n > 0 {
	if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
		return
	}
	// Feed agent state detector if this is an agent terminal
	if detectorLookup != nil {
		detectorLookup.FeedDetector(sessionID, buf[:n])
	}
}
```

- [ ] **Step 5: Update app.go to pass nil DetectorLookup for now**

In `app.go`, update the `ws.NewServer` call:
```go
wsSrv, err := ws.NewServer(a.ptyMgr, nil)
```

This will be replaced with the agent manager in Task 5.

- [ ] **Step 6: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/ws/events.go internal/ws/server.go internal/ws/handler.go app.go
git commit -m "feat: event broadcasting WebSocket, detector feed integration in PTY handler"
```

---

## Task 5: Agent Manager

**Files:**
- Create: `internal/agent/manager.go`
- Create: `internal/agent/manager_test.go`
- Modify: `app.go`

- [ ] **Step 1: Write failing manager tests**

Create `internal/agent/manager_test.go`:

```go
package agent

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/pty"
)

func setupTestEnv(t *testing.T) (*db.Store, *pty.Manager) {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store, pty.NewManager()
}

func TestManagerSpawnAndList(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	// Spawn an agent using /bin/echo (exits immediately)
	agent, err := mgr.Spawn(1, "custom", "test task", "/tmp", "echo hello")
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}
	if agent.ID == "" {
		t.Error("expected non-empty agent ID")
	}
	if agent.Status != AgentStatusStarting {
		t.Errorf("expected starting, got %s", agent.Status)
	}

	agents := mgr.List()
	if len(agents) != 1 {
		t.Errorf("expected 1 agent, got %d", len(agents))
	}

	// Wait for echo to exit
	time.Sleep(500 * time.Millisecond)

	got := mgr.Get(agent.ID)
	if got == nil {
		t.Fatal("expected agent to still exist after exit")
	}
	// Should have transitioned to done (exit 0)
	if got.Status != AgentStatusDone {
		t.Errorf("expected done after exit, got %s", got.Status)
	}
}

func TestManagerSpawnCommandNotFound(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	_, err := mgr.Spawn(1, "custom", "test", "/tmp", "nonexistent_command_xyz")
	if err == nil {
		t.Error("expected error for nonexistent command")
	}
}

func TestManagerStop(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	// Spawn a long-running process
	agent, err := mgr.Spawn(1, "custom", "long task", "/tmp", "sleep 60")
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}

	err = mgr.Stop(agent.ID)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	got := mgr.Get(agent.ID)
	if got == nil {
		t.Fatal("agent should still be in map after stop")
	}
	if got.Status != AgentStatusError && got.Status != AgentStatusDone {
		t.Errorf("expected done or error after stop, got %s", got.Status)
	}
}

func TestManagerListByProject(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	mgr.Spawn(1, "custom", "task 1", "/tmp", "echo a")
	mgr.Spawn(2, "custom", "task 2", "/tmp", "echo b")
	mgr.Spawn(1, "custom", "task 3", "/tmp", "echo c")

	proj1 := mgr.ListByProject(1)
	if len(proj1) != 2 {
		t.Errorf("expected 2 agents for project 1, got %d", len(proj1))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run TestManager`
Expected: FAIL — `NewManager` undefined

- [ ] **Step 3: Implement agent manager**

Create `internal/agent/manager.go`:

```go
package agent

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/pty"
)

type Manager struct {
	agents    map[string]*Agent
	detectors map[string]*StateDetector // keyed by PTY session ID
	ptyMgr    *pty.Manager
	store     *db.Store
	mu        sync.RWMutex
	broadcast func(data []byte)
}

func NewManager(ptyMgr *pty.Manager, store *db.Store, broadcast func(data []byte)) *Manager {
	return &Manager{
		agents:    make(map[string]*Agent),
		detectors: make(map[string]*StateDetector),
		ptyMgr:    ptyMgr,
		store:     store,
		broadcast: broadcast,
	}
}

func (m *Manager) Spawn(projectID int64, agentType, taskDesc, workDir, customCmd string) (*Agent, error) {
	// Resolve command
	var command string
	var displayName string
	var icon string
	var args []string

	if cfg, ok := BuiltinAgents[agentType]; ok {
		command = cfg.Command
		displayName = cfg.DisplayName
		icon = cfg.Icon
		// Build args for claude_code
		if agentType == "claude_code" && taskDesc != "" {
			args = []string{"-p", taskDesc}
		}
	} else {
		command = customCmd
		displayName = customCmd
		runes := []rune(customCmd)
		if len(runes) >= 2 {
			icon = string(runes[:2])
		} else {
			icon = customCmd
		}
	}

	// Validate command exists
	if _, err := exec.LookPath(command); err != nil {
		return nil, fmt.Errorf("command not found: %s", command)
	}

	// Create PTY session
	sessionID, err := m.ptyMgr.Create(command, args, workDir, 120, 30)
	if err != nil {
		return nil, fmt.Errorf("create pty session: %w", err)
	}

	// Capture git HEAD (best effort)
	baseCommit := ""
	gitCmd := exec.Command("git", "rev-parse", "HEAD")
	gitCmd.Dir = workDir
	if out, err := gitCmd.Output(); err == nil {
		baseCommit = strings.TrimSpace(string(out))
	}

	// Create agent_runs row
	now := time.Now().UTC().Format(time.RFC3339)
	agentID := uuid.New().String()
	result, err := m.store.DB.Exec(
		"INSERT INTO agent_runs (project_id, agent_type, task_description, base_commit, status, started_at, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
		projectID, agentType, taskDesc, baseCommit, string(AgentStatusStarting), now, agentID,
	)
	if err != nil {
		// Clean up PTY on DB failure
		m.ptyMgr.Close(sessionID)
		return nil, fmt.Errorf("create agent run: %w", err)
	}
	runID, _ := result.LastInsertId()

	agent := &Agent{
		ID:           agentID,
		RunID:        runID,
		ProjectID:    projectID,
		Type:         agentType,
		DisplayName:  displayName,
		Command:      command,
		Status:       AgentStatusStarting,
		TaskDesc:     taskDesc,
		PTYSessionID: sessionID,
		StartedAt:    time.Now(),
	}

	// Create detector
	detector := NewDetector(agentType, func(status AgentStatus) {
		m.onStatusChange(agent, status)
	})

	m.mu.Lock()
	m.agents[agentID] = agent
	m.detectors[sessionID] = detector
	m.mu.Unlock()

	// Start exit watcher
	go m.watchExit(agent, detector)

	return agent, nil
}

func (m *Manager) watchExit(agent *Agent, detector *StateDetector) {
	sess, ok := m.ptyMgr.Get(agent.PTYSessionID)
	if !ok {
		return
	}
	<-sess.Done
	detector.OnProcessExit(&sess.ExitCode)
}

func (m *Manager) onStatusChange(agent *Agent, status AgentStatus) {
	m.mu.Lock()
	agent.Status = status
	if status == AgentStatusDone || status == AgentStatusError {
		sess, ok := m.ptyMgr.Get(agent.PTYSessionID)
		if ok {
			agent.ExitCode = &sess.ExitCode
		}
	}
	m.mu.Unlock()

	// Update DB
	m.store.DB.Exec(
		"UPDATE agent_runs SET status = ?, completed_at = CASE WHEN ? IN ('done','error') THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE agent_id = ?",
		string(status), string(status), agent.ID,
	)

	// Broadcast to frontend
	event := map[string]interface{}{
		"type":     "agent_status",
		"agentId":  agent.ID,
		"status":   string(status),
	}
	if agent.ExitCode != nil {
		event["exitCode"] = *agent.ExitCode
	}
	data, _ := json.Marshal(event)
	m.broadcast(data)
}

func (m *Manager) Get(id string) *Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.agents[id]
}

func (m *Manager) List() []*Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Agent, 0, len(m.agents))
	for _, a := range m.agents {
		list = append(list, a)
	}
	return list
}

func (m *Manager) ListByProject(projectID int64) []*Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var list []*Agent
	for _, a := range m.agents {
		if a.ProjectID == projectID {
			list = append(list, a)
		}
	}
	return list
}

func (m *Manager) Stop(id string) error {
	m.mu.RLock()
	agent, ok := m.agents[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("agent %s not found", id)
	}

	// Stop detector
	if d, ok := m.detectors[agent.PTYSessionID]; ok {
		d.Stop()
	}

	// Close PTY (triggers exit watcher)
	return m.ptyMgr.Close(agent.PTYSessionID)
}

func (m *Manager) StopByProject(projectID int64) {
	agents := m.ListByProject(projectID)
	for _, a := range agents {
		m.Stop(a.ID)
	}
}

// FeedDetector implements the ws.DetectorLookup interface.
func (m *Manager) FeedDetector(ptySessionID string, data []byte) {
	m.mu.RLock()
	d, ok := m.detectors[ptySessionID]
	m.mu.RUnlock()
	if ok {
		d.Feed(data)
	}
}

func (m *Manager) Shutdown() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.agents))
	for id := range m.agents {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.Stop(id)
	}
}
```

- [ ] **Step 4: Run manager tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run TestManager -timeout 30s`
Expected: ALL PASS

- [ ] **Step 5: Wire agent manager into app.go**

Add to imports:
```go
agentPkg "github.com/kkjorsvik/quarterdeck/internal/agent"
```

Add field to App struct:
```go
agentMgr *agentPkg.Manager
```

Restructure `startup()` — create agent manager BEFORE the WS server (agent manager is the DetectorLookup, and the WS server needs it). Use a closure for broadcast since wsServer doesn't exist yet at agent manager creation time:

```go
a.ptyMgr = ptyPkg.NewManager()
a.agentMgr = agentPkg.NewManager(a.ptyMgr, a.store, func(data []byte) {
    if a.wsServer != nil {
        a.wsServer.EventHub().Broadcast(data)
    }
})

wsSrv, err := ws.NewServer(a.ptyMgr, a.agentMgr)
if err != nil {
    panic("failed to start ws server: " + err.Error())
}
a.wsServer = wsSrv
```

In `shutdown()`, add before `ptyMgr.CloseAll()`:
```go
if a.agentMgr != nil {
    a.agentMgr.Shutdown()
}
```

In `deleteProject()`, add agent cleanup:
```go
func (a *App) DeleteProject(id int64) error {
    if a.agentMgr != nil {
        a.agentMgr.StopByProject(id)
    }
    return a.projects.Delete(id)
}
```

Add Wails-bound methods:
```go
func (a *App) SpawnAgent(projectID int64, agentType, taskDesc, workDir, customCmd string) (*agentPkg.SpawnResult, error) {
    agent, err := a.agentMgr.Spawn(projectID, agentType, taskDesc, workDir, customCmd)
    if err != nil {
        return nil, err
    }
    return &agentPkg.SpawnResult{
        AgentID:      agent.ID,
        PTYSessionID: agent.PTYSessionID,
    }, nil
}

func (a *App) StopAgent(agentID string) error {
    return a.agentMgr.Stop(agentID)
}

func (a *App) ListAgents() []*agentPkg.Agent {
    return a.agentMgr.List()
}

func (a *App) ListProjectAgents(projectID int64) []*agentPkg.Agent {
    return a.agentMgr.ListByProject(projectID)
}
```

- [ ] **Step 6: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/agent/manager.go internal/agent/manager_test.go app.go
git commit -m "feat: agent manager with spawn, stop, exit watcher, event broadcast"
```

---

## Task 6: Frontend Types & Agent Store

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/stores/agentStore.ts`
- Create: `frontend/src/hooks/useAgentEvents.ts`

- [ ] **Step 1: Add agent types**

Append to `frontend/src/lib/types.ts`:

```typescript
// Agent types
export type AgentStatusType = 'starting' | 'working' | 'needs_input' | 'done' | 'error';

export interface AgentState {
  id: string;
  projectId: number;
  type: string;
  displayName: string;
  taskDescription: string;
  status: AgentStatusType;
  ptySessionId: string;
  startedAt: string;
  exitCode: number | null;
}

export interface SpawnResult {
  agentId: string;
  ptySessionId: string;
}
```

- [ ] **Step 2: Create agent store**

Create `frontend/src/stores/agentStore.ts`:

```typescript
import { create } from 'zustand';
import type { AgentState, AgentStatusType } from '../lib/types';

interface AgentStoreState {
  agents: Map<string, AgentState>;

  addAgent: (agent: AgentState) => void;
  updateStatus: (agentId: string, status: AgentStatusType, exitCode?: number) => void;
  removeAgent: (agentId: string) => void;

  getProjectAgents: (projectId: number) => AgentState[];
  getActiveAgents: () => AgentState[];
  getAttentionAgents: () => AgentState[];
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: new Map(),

  addAgent: (agent) => set((state) => {
    const agents = new Map(state.agents);
    agents.set(agent.id, agent);
    return { agents };
  }),

  updateStatus: (agentId, status, exitCode) => set((state) => {
    const agents = new Map(state.agents);
    const agent = agents.get(agentId);
    if (agent) {
      agents.set(agentId, {
        ...agent,
        status,
        exitCode: exitCode !== undefined ? exitCode : agent.exitCode,
      });
    }
    return { agents };
  }),

  removeAgent: (agentId) => set((state) => {
    const agents = new Map(state.agents);
    agents.delete(agentId);
    return { agents };
  }),

  getProjectAgents: (projectId) => {
    return Array.from(get().agents.values()).filter(a => a.projectId === projectId);
  },

  getActiveAgents: () => {
    return Array.from(get().agents.values()).filter(
      a => a.status === 'starting' || a.status === 'working' || a.status === 'needs_input'
    );
  },

  getAttentionAgents: () => {
    return Array.from(get().agents.values()).filter(
      a => a.status === 'needs_input' || a.status === 'error'
    );
  },
}));
```

- [ ] **Step 3: Create event listener hook**

Create `frontend/src/hooks/useAgentEvents.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import type { AgentStatusType } from '../lib/types';

export function useAgentEvents(wsPort: number | null) {
  const updateStatus = useAgentStore(s => s.updateStatus);
  const addAgent = useAgentStore(s => s.addAgent);

  // Hydrate agent store on startup
  useEffect(() => {
    (window as any).go.main.App.ListAgents().then((agents: any[]) => {
      if (agents) {
        for (const a of agents) {
          addAgent({
            id: a.id,
            projectId: a.projectId,
            type: a.type,
            displayName: a.displayName,
            taskDescription: a.taskDescription,
            status: a.status,
            ptySessionId: a.ptySessionId,
            startedAt: a.startedAt,
            exitCode: a.exitCode,
          });
        }
      }
    }).catch(() => {});
  }, [addAgent]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!wsPort) return;

    const connect = () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws/events`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'agent_status') {
            updateStatus(
              msg.agentId,
              msg.status as AgentStatusType,
              msg.exitCode
            );
          }
        } catch { /* ignore non-JSON */ }
      };

      ws.onclose = () => {
        // Reconnect with exponential backoff
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onopen = () => {
        reconnectDelayRef.current = 1000; // reset backoff on successful connect
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [wsPort, updateStatus]);
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/stores/agentStore.ts frontend/src/hooks/useAgentEvents.ts
git commit -m "feat: agent store, types, and WebSocket event listener"
```

---

## Task 7: Spawn Agent Modal

**Files:**
- Create: `frontend/src/components/sidebar/SpawnAgentModal.tsx`

- [ ] **Step 1: Create spawn agent modal**

Create `frontend/src/components/sidebar/SpawnAgentModal.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAgentStore } from '../../stores/agentStore';
import { useLayoutStore } from '../../stores/layoutStore';
import type { AgentState } from '../../lib/types';

const AGENT_TYPES = [
  { type: 'claude_code', label: 'Claude Code', icon: 'CC' },
  { type: 'codex', label: 'Codex', icon: 'CX' },
  { type: 'opencode', label: 'OpenCode', icon: 'OC' },
  { type: 'custom', label: 'Custom', icon: '--' },
];

export function SpawnAgentModal() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const projects = useProjectStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const addAgent = useAgentStore(s => s.addAgent);
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const [agentType, setAgentType] = useState('claude_code');
  const [customCommand, setCustomCommand] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [workDir, setWorkDir] = useState('');
  const [error, setError] = useState('');
  const [spawning, setSpawning] = useState(false);

  useEffect(() => {
    if (active === 'spawnAgent') {
      setAgentType('claude_code');
      setCustomCommand('');
      setTaskDesc('');
      setProjectId(activeProjectId);
      setError('');
      setSpawning(false);
      // Set workDir to active project path
      const project = projects.find(p => p.id === activeProjectId);
      setWorkDir(project?.path || '');
    }
  }, [active, activeProjectId, projects]);

  if (active !== 'spawnAgent') return null;

  const handleSpawn = async () => {
    if (!projectId) { setError('Select a project'); return; }
    if (agentType === 'custom' && !customCommand.trim()) { setError('Enter a command'); return; }

    setSpawning(true);
    setError('');

    try {
      const result = await (window as any).go.main.App.SpawnAgent(
        projectId,
        agentType,
        taskDesc,
        workDir || '/tmp',
        agentType === 'custom' ? customCommand.trim() : ''
      );

      const agentConfig = AGENT_TYPES.find(t => t.type === agentType);
      const agent: AgentState = {
        id: result.agentId,
        projectId,
        type: agentType,
        displayName: agentConfig?.label || customCommand,
        taskDescription: taskDesc,
        status: 'starting',
        ptySessionId: result.ptySessionId,
        startedAt: new Date().toISOString(),
        exitCode: null,
      };

      addAgent(agent);

      // Create terminal tab wired to the agent's PTY session
      const tabTitle = `${agentConfig?.icon || '--'} ${taskDesc.slice(0, 20) || 'Agent'}`;
      addTab(focusedPaneId, {
        type: 'terminal',
        title: tabTitle,
        terminalId: result.ptySessionId,
      });

      close();
    } catch (err: any) {
      setError(err?.message || String(err));
      setSpawning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.ctrlKey) handleSpawn();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: '4px', padding: '8px 10px', color: 'var(--text-primary)',
    fontSize: '12px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={handleKeyDown}
    >
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '24px', width: '420px',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, marginBottom: '16px' }}>
          Spawn Agent
        </div>

        {/* Agent type */}
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Agent Type</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {AGENT_TYPES.map(at => (
              <button
                key={at.type}
                onClick={() => setAgentType(at.type)}
                style={{
                  background: agentType === at.type ? 'var(--accent)' : 'var(--bg-primary)',
                  color: agentType === at.type ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)', borderRadius: '4px',
                  padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {at.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom command */}
        {agentType === 'custom' && (
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Command</label>
            <input style={inputStyle} value={customCommand} onChange={e => setCustomCommand(e.target.value)} placeholder="my-agent" />
          </div>
        )}

        {/* Task description */}
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Task Description (optional)</label>
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={taskDesc}
            onChange={e => setTaskDesc(e.target.value)}
            placeholder="What should the agent do?"
          />
        </div>

        {/* Project */}
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Project</label>
          <select
            value={projectId || ''}
            onChange={e => {
              const id = Number(e.target.value);
              setProjectId(id);
              const p = projects.find(p => p.id === id);
              setWorkDir(p?.path || '');
            }}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">Select project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Working directory */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Working Directory</label>
          <input style={inputStyle} value={workDir} onChange={e => setWorkDir(e.target.value)} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={close}
            style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '4px',
              padding: '8px 16px', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSpawn}
            disabled={spawning}
            style={{
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '4px',
              padding: '8px 16px', fontSize: '12px', cursor: 'pointer',
              opacity: spawning ? 0.6 : 1,
            }}
          >
            {spawning ? 'Spawning...' : 'Launch'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add 'spawnAgent' to overlay types**

In `frontend/src/stores/overlayStore.ts`, update the `OverlayType`:
```typescript
type OverlayType = 'none' | 'addProject' | 'projectSwitcher' | 'fileSearch' | 'spawnAgent';
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/SpawnAgentModal.tsx frontend/src/stores/overlayStore.ts
git commit -m "feat: spawn agent modal with type selection, task description, project picker"
```

---

## Task 8: Agent Card & Agent Section

**Files:**
- Create: `frontend/src/components/sidebar/AgentCard.tsx`
- Create: `frontend/src/components/sidebar/AgentSection.tsx`

- [ ] **Step 1: Create AgentCard component**

Create `frontend/src/components/sidebar/AgentCard.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import type { AgentState } from '../../lib/types';
import { getProjectColor } from '../../lib/projectColors';
import { useProjectStore } from '../../stores/projectStore';
import { ContextMenu } from './ContextMenu';

interface AgentCardProps {
  agent: AgentState;
  onClick: () => void;
  onStop: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  starting: { color: '#60a5fa', label: 'Starting' },
  working: { color: '#34d399', label: 'Working' },
  needs_input: { color: '#facc15', label: 'Input' },
  done: { color: '#34d399', label: 'Done' },
  error: { color: '#f87171', label: 'Error' },
};

function elapsed(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function AgentCard({ agent, onClick, onStop }: AgentCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const projects = useProjectStore(s => s.projects);
  const project = projects.find(p => p.id === agent.projectId);

  // Update elapsed time every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const status = STATUS_CONFIG[agent.status] || STATUS_CONFIG.working;
  const isAttention = agent.status === 'needs_input' || agent.status === 'error';
  const borderColor = isAttention
    ? (agent.status === 'needs_input' ? '#facc15' : '#f87171')
    : 'transparent';

  const icon = agent.type === 'claude_code' ? 'CC'
    : agent.type === 'codex' ? 'CX'
    : agent.type === 'opencode' ? 'OC'
    : agent.displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
        style={{
          padding: '8px 10px', cursor: 'pointer',
          borderLeft: `3px solid ${borderColor}`,
          background: isAttention ? 'rgba(250, 204, 21, 0.05)' : 'transparent',
          fontSize: '12px',
        }}
        onMouseEnter={e => { if (!isAttention) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!isAttention) e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-secondary)', width: '16px' }}>
            {icon}
          </span>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: status.color, flexShrink: 0 }} />
          <span style={{ color: status.color, fontSize: '11px' }}>{status.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{elapsed(agent.startedAt)}</span>
        </div>
        {agent.taskDescription && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginLeft: '22px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={agent.taskDescription}
          >
            {agent.taskDescription.slice(0, 35)}{agent.taskDescription.length > 35 ? '...' : ''}
          </div>
        )}
        {project && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '22px', marginTop: '2px' }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: getProjectColor(project.sortOrder, project.color || null),
            }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{project.name}</span>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Stop Agent', onClick: onStop, danger: true },
          ]}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create AgentSection component**

Create `frontend/src/components/sidebar/AgentSection.tsx`:

```typescript
import React, { useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { AgentCard } from './AgentCard';

export function AgentSection() {
  const agents = useAgentStore(s => s.agents);
  const switchProject = useProjectStore(s => s.switchProject);
  const openOverlay = useOverlayStore(s => s.open);
  const setActiveTab = useLayoutStore(s => s.setActiveTab);
  const getLeafById = useLayoutStore(s => s.getLeafById);
  const setFocusedPane = useLayoutStore(s => s.setFocusedPane);
  const [collapsed, setCollapsed] = useState(false);

  const agentList = Array.from(agents.values());
  if (agentList.length === 0 && collapsed) return null;

  const attentionCount = agentList.filter(a => a.status === 'needs_input' || a.status === 'error').length;
  const activeCount = agentList.filter(a => a.status !== 'done' && a.status !== 'error').length;

  const handleAgentClick = async (agent: { projectId: number; ptySessionId: string }) => {
    await switchProject(agent.projectId);
    // Focus the terminal tab for this agent
    // Search all leaves for a tab with matching terminalId
    // This is best-effort — if the tab doesn't exist, just switch to the project
  };

  const handleStopAgent = async (agentId: string) => {
    try {
      await (window as any).go.main.App.StopAgent(agentId);
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  // Summary for collapsed state
  let summary = `${agentList.length} agent${agentList.length !== 1 ? 's' : ''}`;
  if (attentionCount > 0) {
    summary += ` (${attentionCount} needs input)`;
  }

  const summaryColor = attentionCount > 0 ? '#facc15' : 'var(--text-secondary)';

  return (
    <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '6px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <span style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          {collapsed ? `▶ Agents · ${summary}` : 'Agents'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); openOverlay('spawnAgent'); }}
          style={{
            background: 'none', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', cursor: 'pointer',
            padding: '1px 6px', fontSize: '11px', borderRadius: '3px',
          }}
        >
          + New
        </button>
      </div>

      {/* Agent list */}
      {!collapsed && agentList.length > 0 && (
        <div>
          {agentList.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => handleAgentClick(agent)}
              onStop={() => handleStopAgent(agent.id)}
            />
          ))}
        </div>
      )}

      {!collapsed && agentList.length === 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: '11px', textAlign: 'center' }}>
          No active agents
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/AgentCard.tsx frontend/src/components/sidebar/AgentSection.tsx
git commit -m "feat: agent card and collapsible agent section for sidebar"
```

---

## Task 9: Wire Everything Into App & Sidebar

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add AgentSection to Sidebar**

In `Sidebar.tsx`, import and render `AgentSection` between the project list and the file tree:

```typescript
import { AgentSection } from './AgentSection';
```

Insert after the project list `</div>` and before the file tree label:
```tsx
<AgentSection />
```

- [ ] **Step 2: Wire agent events and shortcuts into App.tsx**

In `App.tsx`:

Import:
```typescript
import { useAgentEvents } from './hooks/useAgentEvents';
import { SpawnAgentModal } from './components/sidebar/SpawnAgentModal';
```

Add WS port state and agent events hook:
```typescript
const [wsPort, setWsPort] = useState<number | null>(null);

useEffect(() => {
  window.go.main.App.GetWSPort().then(setWsPort);
}, []);

useAgentEvents(wsPort);
```

Add keyboard shortcut for `Ctrl+Shift+A`:
```typescript
case 'A':
  e.preventDefault();
  toggleOverlay('spawnAgent');
  break;
```

Render the spawn modal:
```tsx
<SpawnAgentModal />
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat: wire agent section into sidebar, event listener, Ctrl+Shift+A shortcut"
```

---

## Task 10: Wails Bindings & Smoke Test

- [ ] **Step 1: Regenerate Wails bindings**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && wails generate module`

- [ ] **Step 2: Run all Go tests**

Run: `go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 3: Build the full application**

Run: `wails build`
Expected: Build succeeds

- [ ] **Step 4: Commit generated bindings**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for agent management"
```

---

## Summary

10 tasks, ordered by dependency:

1. **SQLite migration + PTY args** — foundation (extends PTY for agent commands)
2. **Agent types + patterns** — data model (types, configs, regex patterns)
3. **State detector** — core intelligence (timing + regex + debounce, TDD)
4. **WebSocket events** — broadcast channel (EventHub, DetectorLookup interface, handler integration)
5. **Agent manager** — lifecycle orchestration (spawn, stop, exit watcher, DB rows, TDD)
6. **Frontend types + store** — state management (agent store, event listener hook)
7. **Spawn agent modal** — UI for creating agents
8. **Agent card + section** — sidebar UI for monitoring agents
9. **App + sidebar wiring** — connect everything (shortcuts, events, render)
10. **Bindings + smoke test** — integration verification

**Critical path:** 1 → 2 → 3 → 4 → 5 (backend core), then 6 → 7 → 8 → 9 → 10 (frontend)
