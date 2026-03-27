# Agent Management Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop notifications, git-based run tracking, status bar agent counts, and agent-aware sidebar indicators to complete the agent management feature.

**Architecture:** Desktop notifications via `notify-send` (fire-and-forget). Git helpers in `internal/git/` shell out to git CLI. Manager calls notify + git tracking in `onStatusChange`. Frontend reads from existing `agentStore` for status bar and sidebar upgrades.

**Tech Stack:** Go 1.25, git CLI, notify-send, React 18, Zustand, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-26-agent-polish-design.md`

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/git/git.go` | Create | HeadCommit, DiffFileList, DiffWorkingTree helpers |
| `internal/git/git_test.go` | Create | Tests with temp git repos |
| `internal/agent/notify.go` | Create | Notify via notify-send |
| `internal/agent/agent.go` | Modify | Add WorkDir, BaseCommit fields |
| `internal/agent/manager.go` | Modify | Set WorkDir/BaseCommit on spawn, call notify + run tracking on completion |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/layout/StatusBar.tsx` | Modify | Add agent count section |
| `frontend/src/components/sidebar/ProjectEntry.tsx` | Modify | Agent-aware activity dots |

---

## Task 1: Git Helpers

**Files:**
- Create: `internal/git/git.go`
- Create: `internal/git/git_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/git/git_test.go`:

```go
package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, out)
		}
	}
	run("init")
	run("config", "user.email", "test@test.com")
	run("config", "user.name", "test")
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("hello"), 0644)
	run("add", ".")
	run("commit", "-m", "initial")
	return dir
}

func TestHeadCommit(t *testing.T) {
	dir := initTestRepo(t)
	commit, err := HeadCommit(dir)
	if err != nil {
		t.Fatalf("HeadCommit failed: %v", err)
	}
	if len(commit) != 40 {
		t.Errorf("expected 40-char SHA, got %q (len %d)", commit, len(commit))
	}
}

func TestHeadCommitNotARepo(t *testing.T) {
	dir := t.TempDir()
	_, err := HeadCommit(dir)
	if err == nil {
		t.Error("expected error for non-repo directory")
	}
}

func TestDiffFileList(t *testing.T) {
	dir := initTestRepo(t)
	base, _ := HeadCommit(dir)

	// Make changes and commit
	os.WriteFile(filepath.Join(dir, "file2.txt"), []byte("new file"), 0644)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("modified"), 0644)
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com")
		cmd.CombinedOutput()
	}
	run("add", ".")
	run("commit", "-m", "changes")

	head, _ := HeadCommit(dir)
	changes, err := DiffFileList(dir, base, head)
	if err != nil {
		t.Fatalf("DiffFileList failed: %v", err)
	}

	found := map[string]string{}
	for _, c := range changes {
		found[c.Path] = c.ChangeType
	}
	if found["file1.txt"] != "M" {
		t.Errorf("expected file1.txt modified, got %q", found["file1.txt"])
	}
	if found["file2.txt"] != "A" {
		t.Errorf("expected file2.txt added, got %q", found["file2.txt"])
	}
}

func TestDiffWorkingTree(t *testing.T) {
	dir := initTestRepo(t)

	// Make uncommitted changes
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed"), 0644)
	os.WriteFile(filepath.Join(dir, "newfile.txt"), []byte("brand new"), 0644)

	changes, err := DiffWorkingTree(dir)
	if err != nil {
		t.Fatalf("DiffWorkingTree failed: %v", err)
	}

	found := map[string]string{}
	for _, c := range changes {
		found[c.Path] = c.ChangeType
	}
	if found["file1.txt"] != "M" {
		t.Errorf("expected file1.txt modified, got %q", found["file1.txt"])
	}
}

func TestDiffFileListWithDelete(t *testing.T) {
	dir := initTestRepo(t)
	base, _ := HeadCommit(dir)

	os.Remove(filepath.Join(dir, "file1.txt"))
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com")
		cmd.CombinedOutput()
	}
	run("add", ".")
	run("commit", "-m", "delete")

	head, _ := HeadCommit(dir)
	changes, _ := DiffFileList(dir, base, head)

	found := map[string]string{}
	for _, c := range changes {
		found[c.Path] = c.ChangeType
	}
	if found["file1.txt"] != "D" {
		t.Errorf("expected file1.txt deleted, got %q", found["file1.txt"])
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/git/ -v`
Expected: FAIL — package doesn't exist

- [ ] **Step 3: Implement git helpers**

Create `internal/git/git.go`:

```go
package git

import (
	"fmt"
	"os/exec"
	"strings"
)

type FileChange struct {
	Path       string
	ChangeType string // "A", "M", "D"
}

// HeadCommit returns the current HEAD SHA.
func HeadCommit(repoPath string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// DiffFileList returns files changed between two commits.
func DiffFileList(repoPath, fromRef, toRef string) ([]FileChange, error) {
	cmd := exec.Command("git", "diff", "--name-status", fromRef, toRef)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --name-status: %w", err)
	}
	return parseNameStatus(string(out)), nil
}

// DiffWorkingTree returns uncommitted changes (staged + unstaged).
func DiffWorkingTree(repoPath string) ([]FileChange, error) {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status --porcelain: %w", err)
	}
	return parsePorcelain(string(out)), nil
}

func parseNameStatus(output string) []FileChange {
	var changes []FileChange
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		changeType := parts[0]
		path := parts[len(parts)-1] // use last field (handles renames: R100 old new → use new)

		// Normalize: R* → A, C* → A
		switch {
		case strings.HasPrefix(changeType, "R"):
			changeType = "A"
		case strings.HasPrefix(changeType, "C"):
			changeType = "A"
		}

		if changeType == "A" || changeType == "M" || changeType == "D" {
			changes = append(changes, FileChange{Path: path, ChangeType: changeType})
		}
	}
	return changes
}

func parsePorcelain(output string) []FileChange {
	var changes []FileChange
	seen := make(map[string]bool)
	for _, line := range strings.Split(output, "\n") {
		if len(line) < 4 {
			continue
		}
		// Porcelain format: XY filename
		// X = staged status, Y = unstaged status
		x := line[0]
		y := line[1]
		path := strings.TrimSpace(line[3:])

		// Handle renames (path contains " -> ")
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}

		if seen[path] {
			continue
		}
		seen[path] = true

		// Determine change type from either X or Y (prefer staged)
		var changeType string
		switch {
		case x == 'A' || y == 'A' || x == '?' :
			changeType = "A"
		case x == 'D' || y == 'D':
			changeType = "D"
		case x == 'M' || y == 'M' || x == 'R':
			changeType = "M"
		default:
			changeType = "M" // fallback
		}

		changes = append(changes, FileChange{Path: path, ChangeType: changeType})
	}
	return changes
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/git/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/git/
git commit -m "feat: git helpers for HeadCommit, DiffFileList, DiffWorkingTree"
```

---

## Task 2: Desktop Notifications & Agent Struct Updates

**Files:**
- Create: `internal/agent/notify.go`
- Modify: `internal/agent/agent.go`

- [ ] **Step 1: Create notify function**

Create `internal/agent/notify.go`:

```go
package agent

import "os/exec"

// Notify sends a desktop notification via notify-send. Fire-and-forget.
func Notify(title, body, urgency string) {
	cmd := exec.Command("notify-send",
		"--urgency", urgency,
		"--app-name", "Quarterdeck",
		title,
		body,
	)
	cmd.Start() // don't wait, don't check error
}
```

- [ ] **Step 2: Add WorkDir and BaseCommit to Agent struct**

In `internal/agent/agent.go`, add two fields to the `Agent` struct:

```go
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
	WorkDir      string      `json:"workDir"`
	BaseCommit   string      `json:"baseCommit"`
	StartedAt    time.Time   `json:"startedAt"`
	ExitCode     *int        `json:"exitCode"`
}
```

- [ ] **Step 3: Commit**

```bash
git add internal/agent/notify.go internal/agent/agent.go
git commit -m "feat: desktop notifications via notify-send, add WorkDir/BaseCommit to Agent"
```

---

## Task 3: Manager Integration — Notifications & Run Tracking

**Files:**
- Modify: `internal/agent/manager.go`

- [ ] **Step 1: Set WorkDir and BaseCommit on spawn**

In `manager.go`'s `Spawn` method, when creating the agent struct (around line 106), add:

```go
agent := &Agent{
	// ... existing fields ...
	WorkDir:    workDir,
	BaseCommit: baseCommit,
	// ...
}
```

`workDir` is already a parameter. `baseCommit` is already captured above (line 74-78).

- [ ] **Step 2: Add notifications to onStatusChange**

In `manager.go`'s `onStatusChange` method, after the status update and before the broadcast, add notification logic:

```go
func (m *Manager) onStatusChange(agent *Agent, status AgentStatus) {
	m.mu.Lock()
	agent.Status = status
	m.mu.Unlock()

	// Desktop notification
	projectName := fmt.Sprintf("[project %d]", agent.ProjectID)
	// Look up project name from DB (best effort)
	var pName string
	err := m.store.DB.QueryRow("SELECT name FROM projects WHERE id = ?", agent.ProjectID).Scan(&pName)
	if err == nil {
		projectName = fmt.Sprintf("[%s]", pName)
	}

	switch status {
	case AgentStatusNeedsInput:
		Notify(projectName+" Agent needs input", agent.DisplayName, "normal")
	case AgentStatusDone:
		Notify(projectName+" Agent finished", agent.DisplayName, "low")
	case AgentStatusError:
		body := agent.DisplayName
		if agent.ExitCode != nil {
			body = fmt.Sprintf("%s (exit code %d)", agent.DisplayName, *agent.ExitCode)
		}
		Notify(projectName+" Agent errored", body, "critical")
	}

	// Run tracking on completion
	if status == AgentStatusDone || status == AgentStatusError {
		m.trackRun(agent)
	}

	// Update DB (existing code)
	// ... keep existing DB update logic ...

	// Broadcast (existing code)
	// ... keep existing broadcast logic ...
}
```

- [ ] **Step 3: Implement trackRun method**

Add to `manager.go`:

```go
func (m *Manager) trackRun(agent *Agent) {
	if agent.BaseCommit == "" || agent.RunID == 0 {
		return // not a git repo or no DB row
	}

	endCommit, err := gitPkg.HeadCommit(agent.WorkDir)
	if err != nil {
		log.Printf("run tracking: failed to get HEAD: %v", err)
		return
	}

	// Get changed files
	var changes []gitPkg.FileChange
	if endCommit != agent.BaseCommit {
		changes, err = gitPkg.DiffFileList(agent.WorkDir, agent.BaseCommit, endCommit)
	} else {
		changes, err = gitPkg.DiffWorkingTree(agent.WorkDir)
	}
	if err != nil {
		log.Printf("run tracking: failed to get diff: %v", err)
	}

	// Update agent_runs with end_commit
	_, err = m.store.DB.Exec(
		"UPDATE agent_runs SET end_commit = ? WHERE id = ?",
		endCommit, agent.RunID,
	)
	if err != nil {
		log.Printf("run tracking: failed to update end_commit: %v", err)
	}

	// Insert file changes
	for _, change := range changes {
		_, err := m.store.DB.Exec(
			"INSERT INTO run_file_changes (run_id, file_path, change_type) VALUES (?, ?, ?)",
			agent.RunID, change.Path, change.ChangeType,
		)
		if err != nil {
			log.Printf("run tracking: failed to insert file change: %v", err)
		}
	}
}
```

Add import for the git package:
```go
gitPkg "github.com/kkjorsvik/quarterdeck/internal/git"
```

- [ ] **Step 4: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/agent/manager.go
git commit -m "feat: notifications and git run tracking on agent completion"
```

---

## Task 4: Status Bar Agent Integration

**Files:**
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Add agent status to StatusBar**

In `StatusBar.tsx`:

Import the agent store:
```typescript
import { useAgentStore } from '../../stores/agentStore';
```

Inside the component, get agent data:
```typescript
const allAgents = useAgentStore(s => s.agents);
const agentList = Array.from(allAgents.values());
const activeAgents = agentList.filter(a => ['starting', 'working', 'needs_input'].includes(a.status));
const needsInputCount = agentList.filter(a => a.status === 'needs_input').length;
const hasError = agentList.some(a => a.status === 'error');
```

Add the agent section before the terminal count span (before `<span>⬚ {termCount}</span>`):

```tsx
{activeAgents.length > 0 && (
  <span style={{
    color: hasError ? '#f87171' : needsInputCount > 0 ? '#facc15' : 'var(--text-secondary)',
  }}>
    {activeAgents.length} agent{activeAgents.length !== 1 ? 's' : ''}
    {needsInputCount > 0 && ` (${needsInputCount} needs input)`}
  </span>
)}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx
git commit -m "feat: agent count and attention status in status bar"
```

---

## Task 5: Sidebar Activity Indicator Upgrade

**Files:**
- Modify: `frontend/src/components/sidebar/ProjectEntry.tsx`

- [ ] **Step 1: Add agent-aware dot logic**

In `ProjectEntry.tsx`:

Import agent store:
```typescript
import { useAgentStore } from '../../stores/agentStore';
```

Get project agents:
```typescript
const projectAgents = useAgentStore(s => s.getProjectAgents(project.id));
```

Replace the `getActivityDot` callback with agent-aware logic:

```typescript
const getActivityDot = useCallback(() => {
  if (isActive) return null;

  // Agent-based indicators (priority over terminal indicators)
  if (projectAgents.length > 0) {
    if (projectAgents.some(a => a.status === 'error')) {
      return { color: '#f87171', bright: true }; // red
    }
    if (projectAgents.some(a => a.status === 'needs_input')) {
      return { color: '#facc15', bright: true }; // yellow
    }
    if (projectAgents.every(a => a.status === 'done')) {
      return { color: '#34d399', bright: false }; // green (done)
    }
    if (projectAgents.some(a => a.status === 'working' || a.status === 'starting')) {
      return { color: '#34d399', bright: false }; // green (working)
    }
  }

  // Fallback: Phase 3 terminal-based indicators
  if (bgTerminals.length === 0) return null;

  const allExited = bgTerminals.every(t => t.exitInfo !== null);
  if (allExited) return { color: '#6b7280', bright: false }; // gray

  if (bgHasNewOutput && bgOutputTimestamp) {
    const age = Date.now() - bgOutputTimestamp;
    if (age < 30000) {
      return { color: '#facc15', bright: true }; // bright yellow
    }
    return { color: '#ca8a04', bright: false }; // dimmer yellow
  }

  return null;
}, [isActive, projectAgents, bgTerminals, bgHasNewOutput, bgOutputTimestamp]);
```

Add `projectAgents` to the dependency array.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/ProjectEntry.tsx
git commit -m "feat: agent-aware sidebar activity indicators with Phase 3 fallback"
```

---

## Summary

5 tasks, ordered by dependency:

1. **Git helpers** — HeadCommit, DiffFileList, DiffWorkingTree (TDD, standalone)
2. **Notify + Agent struct** — notify-send function, WorkDir/BaseCommit fields
3. **Manager integration** — wire notifications + run tracking into onStatusChange
4. **Status bar** — agent count display with attention coloring
5. **Sidebar indicators** — agent-aware dots replacing terminal-only dots

**Critical path:** 1 → 2 → 3 (backend), then 4 and 5 (frontend, independent)
