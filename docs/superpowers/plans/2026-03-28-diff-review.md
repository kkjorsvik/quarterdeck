# Diff & Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the code review workflow — view agent diffs in Monaco diff editor, accept/reject individual files, commit reviewed work with pre-populated messages.

**Architecture:** Backend provides run history queries and git file retrieval (`git show`). Frontend renders Monaco diff editor for side-by-side review. Accept is UI-only state; reject reverts files via git. Commit stages accepted files and creates a commit with agent run metadata.

**Tech Stack:** Go 1.25, git CLI, SQLite, React 18, Zustand, Monaco Editor (`createDiffEditor`), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-27-diff-review-design.md`

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/git/git.go` | Modify | Add ShowFile, DiffNumstat, DiffNumstatWorkingTree |
| `internal/git/git_test.go` | Modify | Tests for new helpers |
| `internal/agent/manager.go` | Modify | Update trackRun to capture additions/deletions |
| `internal/agent/run.go` | Create | AgentRunWithStats, RunFileChange, FileDiff types + query methods |
| `internal/agent/run_test.go` | Create | Tests for run queries |
| `app.go` | Modify | Wails bindings for review workflow |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add review types, extend PanelTab and PaneType |
| `frontend/src/stores/reviewStore.ts` | Create | File decisions, active file, diff mode |
| `frontend/src/components/review/RunHistory.tsx` | Create | Run history list panel |
| `frontend/src/components/review/RunReview.tsx` | Create | Review layout: file list + diff viewer |
| `frontend/src/components/review/FileChangeList.tsx` | Create | File list with accept/reject |
| `frontend/src/components/review/DiffViewer.tsx` | Create | Monaco diff editor wrapper |
| `frontend/src/components/review/CommitModal.tsx` | Create | Commit dialog |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render review/runHistory tabs |
| `frontend/src/App.tsx` | Modify | Ctrl+Shift+D shortcut |
| `frontend/src/stores/overlayStore.ts` | Modify | Add 'commitReview' type |

---

## Task 1: Git Helpers — ShowFile & DiffNumstat

**Files:**
- Modify: `internal/git/git.go`
- Modify: `internal/git/git_test.go`

- [ ] **Step 1: Write failing tests for ShowFile**

Add to `internal/git/git_test.go`:

```go
func TestShowFile(t *testing.T) {
	dir := initTestRepo(t)
	commit, _ := HeadCommit(dir)

	content, err := ShowFile(dir, commit, "file1.txt")
	if err != nil {
		t.Fatalf("ShowFile failed: %v", err)
	}
	if content != "hello" {
		t.Errorf("expected 'hello', got %q", content)
	}
}

func TestShowFileNotFound(t *testing.T) {
	dir := initTestRepo(t)
	commit, _ := HeadCommit(dir)

	_, err := ShowFile(dir, commit, "nonexistent.txt")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestDiffNumstat(t *testing.T) {
	dir := initTestRepo(t)
	base, _ := HeadCommit(dir)

	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("hello\nworld\nfoo"), 0644)
	os.WriteFile(filepath.Join(dir, "file2.txt"), []byte("new content\nline2"), 0644)
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

	stats, err := DiffNumstat(dir, base, head)
	if err != nil {
		t.Fatalf("DiffNumstat failed: %v", err)
	}

	if s, ok := stats["file1.txt"]; !ok {
		t.Error("expected file1.txt in numstat")
	} else if s[0] < 1 {
		t.Errorf("expected additions > 0 for file1.txt, got %d", s[0])
	}

	if _, ok := stats["file2.txt"]; !ok {
		t.Error("expected file2.txt in numstat")
	}
}

func TestDiffNumstatWorkingTree(t *testing.T) {
	dir := initTestRepo(t)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed\ncontent\nhere"), 0644)

	stats, err := DiffNumstatWorkingTree(dir)
	if err != nil {
		t.Fatalf("DiffNumstatWorkingTree failed: %v", err)
	}
	if _, ok := stats["file1.txt"]; !ok {
		t.Error("expected file1.txt in working tree numstat")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/git/ -v -run "TestShowFile|TestDiffNumstat"`
Expected: FAIL — undefined functions

- [ ] **Step 3: Implement ShowFile, DiffNumstat, DiffNumstatWorkingTree**

Add to `internal/git/git.go`:

```go
// ShowFile returns the content of a file at a specific commit.
func ShowFile(repoPath, commitRef, filePath string) (string, error) {
	cmd := exec.Command("git", "show", commitRef+":"+filePath)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git show %s:%s: %w", commitRef, filePath, err)
	}
	return string(out), nil
}

// DiffNumstat returns additions/deletions per file between two refs.
func DiffNumstat(repoPath, fromRef, toRef string) (map[string][2]int, error) {
	cmd := exec.Command("git", "diff", "--numstat", fromRef, toRef)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --numstat: %w", err)
	}
	return parseNumstat(string(out)), nil
}

// DiffNumstatWorkingTree returns additions/deletions for uncommitted changes.
func DiffNumstatWorkingTree(repoPath string) (map[string][2]int, error) {
	cmd := exec.Command("git", "diff", "--numstat", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --numstat HEAD: %w", err)
	}
	return parseNumstat(string(out)), nil
}

func parseNumstat(output string) map[string][2]int {
	result := make(map[string][2]int)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		// Binary files show "-" for additions/deletions
		if parts[0] == "-" || parts[1] == "-" {
			result[parts[2]] = [2]int{0, 0}
			continue
		}
		var add, del int
		fmt.Sscanf(parts[0], "%d", &add)
		fmt.Sscanf(parts[1], "%d", &del)
		path := parts[2]
		// Handle renames: "old => new" or "{old => new}/path"
		if len(parts) > 3 {
			path = parts[len(parts)-1]
		}
		result[path] = [2]int{add, del}
	}
	return result
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/git/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/git/
git commit -m "feat: git ShowFile, DiffNumstat, DiffNumstatWorkingTree helpers"
```

---

## Task 2: Backfill trackRun with Diff Stats

**Files:**
- Modify: `internal/agent/manager.go`

- [ ] **Step 1: Update trackRun to capture additions/deletions**

In `manager.go`, modify the `trackRun` method. After getting the file change list and before inserting rows, call `DiffNumstat` to get line counts:

```go
func (m *Manager) trackRun(agent *Agent) {
	if agent.BaseCommit == "" || agent.RunID == 0 {
		return
	}

	endCommit, err := gitPkg.HeadCommit(agent.WorkDir)
	if err != nil {
		log.Printf("run tracking: failed to get HEAD: %v", err)
		return
	}

	var changes []gitPkg.FileChange
	var numstats map[string][2]int

	if endCommit != agent.BaseCommit {
		changes, err = gitPkg.DiffFileList(agent.WorkDir, agent.BaseCommit, endCommit)
		if err != nil {
			log.Printf("run tracking: failed to get diff: %v", err)
		}
		numstats, err = gitPkg.DiffNumstat(agent.WorkDir, agent.BaseCommit, endCommit)
		if err != nil {
			log.Printf("run tracking: failed to get numstat: %v", err)
		}
	} else {
		changes, err = gitPkg.DiffWorkingTree(agent.WorkDir)
		if err != nil {
			log.Printf("run tracking: failed to get diff: %v", err)
		}
		numstats, err = gitPkg.DiffNumstatWorkingTree(agent.WorkDir)
		if err != nil {
			log.Printf("run tracking: failed to get numstat: %v", err)
		}
	}

	if _, err := m.store.DB.Exec(
		"UPDATE agent_runs SET end_commit = ? WHERE id = ?",
		endCommit, agent.RunID,
	); err != nil {
		log.Printf("run tracking: failed to update end_commit: %v", err)
	}

	for _, change := range changes {
		additions, deletions := 0, 0
		if numstats != nil {
			if stats, ok := numstats[change.Path]; ok {
				additions = stats[0]
				deletions = stats[1]
			}
		}
		if _, err := m.store.DB.Exec(
			"INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (?, ?, ?, ?, ?)",
			agent.RunID, change.Path, change.ChangeType, additions, deletions,
		); err != nil {
			log.Printf("run tracking: failed to insert file change: %v", err)
		}
	}
}
```

- [ ] **Step 2: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add internal/agent/manager.go
git commit -m "feat: capture additions/deletions in trackRun via numstat"
```

---

## Task 3: Run Query Service

**Files:**
- Create: `internal/agent/run.go`
- Create: `internal/agent/run_test.go`
- Modify: `app.go`

- [ ] **Step 1: Write failing tests**

Create `internal/agent/run_test.go`:

```go
package agent

import (
	"path/filepath"
	"testing"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

func setupRunTestDB(t *testing.T) *db.Store {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestListProjectRuns(t *testing.T) {
	store := setupRunTestDB(t)

	// Insert test data
	store.DB.Exec("INSERT INTO projects (name, path) VALUES ('test', '/tmp/test')")
	store.DB.Exec("INSERT INTO agent_runs (project_id, agent_type, task_description, status, base_commit, end_commit, agent_id) VALUES (1, 'claude_code', 'fix bug', 'done', 'abc1234', 'def5678', 'agent-1')")
	store.DB.Exec("INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (1, 'main.go', 'M', 10, 5)")
	store.DB.Exec("INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (1, 'test.go', 'A', 30, 0)")

	svc := NewRunService(store)
	runs, err := svc.ListProjectRuns(1)
	if err != nil {
		t.Fatalf("ListProjectRuns failed: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].FileCount != 2 {
		t.Errorf("expected 2 files, got %d", runs[0].FileCount)
	}
	if runs[0].TotalAdditions != 40 {
		t.Errorf("expected 40 additions, got %d", runs[0].TotalAdditions)
	}
	if runs[0].TotalDeletions != 5 {
		t.Errorf("expected 5 deletions, got %d", runs[0].TotalDeletions)
	}
}

func TestGetRunFileChanges(t *testing.T) {
	store := setupRunTestDB(t)

	store.DB.Exec("INSERT INTO projects (name, path) VALUES ('test', '/tmp/test')")
	store.DB.Exec("INSERT INTO agent_runs (project_id, agent_type, status) VALUES (1, 'claude_code', 'done')")
	store.DB.Exec("INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (1, 'main.go', 'M', 10, 5)")

	svc := NewRunService(store)
	changes, err := svc.GetRunFileChanges(1)
	if err != nil {
		t.Fatalf("GetRunFileChanges failed: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].FilePath != "main.go" {
		t.Errorf("expected main.go, got %s", changes[0].FilePath)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run "TestListProjectRuns|TestGetRunFileChanges"`
Expected: FAIL — `NewRunService` undefined

- [ ] **Step 3: Implement run service**

Create `internal/agent/run.go`:

```go
package agent

import (
	"fmt"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

type RunService struct {
	store *db.Store
}

func NewRunService(store *db.Store) *RunService {
	return &RunService{store: store}
}

type AgentRunWithStats struct {
	ID              int64  `json:"id"`
	ProjectID       int64  `json:"projectId"`
	AgentType       string `json:"agentType"`
	TaskDescription string `json:"taskDescription"`
	BaseCommit      string `json:"baseCommit"`
	EndCommit       string `json:"endCommit"`
	Status          string `json:"status"`
	StartedAt       string `json:"startedAt"`
	CompletedAt     string `json:"completedAt"`
	AgentID         string `json:"agentId"`
	FileCount       int    `json:"fileCount"`
	TotalAdditions  int    `json:"totalAdditions"`
	TotalDeletions  int    `json:"totalDeletions"`
}

type RunFileChange struct {
	ID         int64  `json:"id"`
	RunID      int64  `json:"runId"`
	FilePath   string `json:"filePath"`
	ChangeType string `json:"changeType"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
}

type FileDiff struct {
	FilePath   string `json:"filePath"`
	Original   string `json:"original"`
	Modified   string `json:"modified"`
	ChangeType string `json:"changeType"`
}

func (s *RunService) ListProjectRuns(projectID int64) ([]AgentRunWithStats, error) {
	rows, err := s.store.DB.Query(`
		SELECT
			ar.id, ar.project_id, COALESCE(ar.agent_type,''), COALESCE(ar.task_description,''),
			COALESCE(ar.base_commit,''), COALESCE(ar.end_commit,''), COALESCE(ar.status,''),
			COALESCE(ar.started_at,''), COALESCE(ar.completed_at,''), COALESCE(ar.agent_id,''),
			COUNT(rfc.id) as file_count,
			COALESCE(SUM(rfc.additions), 0) as total_additions,
			COALESCE(SUM(rfc.deletions), 0) as total_deletions
		FROM agent_runs ar
		LEFT JOIN run_file_changes rfc ON rfc.run_id = ar.id
		WHERE ar.project_id = ?
		GROUP BY ar.id
		ORDER BY ar.started_at DESC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query project runs: %w", err)
	}
	defer rows.Close()

	var runs []AgentRunWithStats
	for rows.Next() {
		var r AgentRunWithStats
		if err := rows.Scan(&r.ID, &r.ProjectID, &r.AgentType, &r.TaskDescription,
			&r.BaseCommit, &r.EndCommit, &r.Status,
			&r.StartedAt, &r.CompletedAt, &r.AgentID,
			&r.FileCount, &r.TotalAdditions, &r.TotalDeletions); err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

func (s *RunService) GetRunFileChanges(runID int64) ([]RunFileChange, error) {
	rows, err := s.store.DB.Query(
		"SELECT id, run_id, file_path, change_type, COALESCE(additions,0), COALESCE(deletions,0) FROM run_file_changes WHERE run_id = ? ORDER BY change_type, file_path",
		runID,
	)
	if err != nil {
		return nil, fmt.Errorf("query run file changes: %w", err)
	}
	defer rows.Close()

	var changes []RunFileChange
	for rows.Next() {
		var c RunFileChange
		if err := rows.Scan(&c.ID, &c.RunID, &c.FilePath, &c.ChangeType, &c.Additions, &c.Deletions); err != nil {
			return nil, fmt.Errorf("scan file change: %w", err)
		}
		changes = append(changes, c)
	}
	return changes, rows.Err()
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/agent/ -v -run "TestListProjectRuns|TestGetRunFileChanges"`
Expected: PASS

- [ ] **Step 5: Add Wails bindings**

In `app.go`, add a `runService` field and init in startup:
```go
runService *agentPkg.RunService
```
```go
a.runService = agentPkg.NewRunService(a.store)
```

Add bindings:
```go
func (a *App) ListProjectRuns(projectID int64) ([]agentPkg.AgentRunWithStats, error) {
	return a.runService.ListProjectRuns(projectID)
}

func (a *App) GetRunFileChanges(runID int64) ([]agentPkg.RunFileChange, error) {
	return a.runService.GetRunFileChanges(runID)
}

func (a *App) GetFileDiff(projectID int64, baseCommit, endCommit, filePath string) (*agentPkg.FileDiff, error) {
	project, err := a.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	original, _ := gitPkg.ShowFile(project.Path, baseCommit, filePath)
	modified, _ := gitPkg.ShowFile(project.Path, endCommit, filePath)
	return &agentPkg.FileDiff{
		FilePath: filePath,
		Original: original,
		Modified: modified,
	}, nil
}

func (a *App) RevertFile(projectID int64, baseCommit, filePath, changeType string) error {
	project, err := a.projects.Get(projectID)
	if err != nil {
		return err
	}
	if changeType == "A" {
		return os.Remove(filepath.Join(project.Path, filePath))
	}
	cmd := exec.Command("git", "checkout", baseCommit, "--", filePath)
	cmd.Dir = project.Path
	return cmd.Run()
}

func (a *App) CommitReviewedChanges(projectID int64, message string, filePaths []string, push bool) (string, error) {
	project, err := a.projects.Get(projectID)
	if err != nil {
		return "", err
	}
	for _, fp := range filePaths {
		cmd := exec.Command("git", "add", fp)
		cmd.Dir = project.Path
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("stage %s: %w", fp, err)
		}
	}
	cmd := exec.Command("git", "commit", "-m", message)
	cmd.Dir = project.Path
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	if push {
		cmd = exec.Command("git", "push")
		cmd.Dir = project.Path
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("push: %w", err)
		}
	}
	sha, _ := gitPkg.HeadCommit(project.Path)
	return sha, nil
}
```

Add import for `gitPkg "github.com/kkjorsvik/quarterdeck/internal/git"` if not already present.

- [ ] **Step 6: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/agent/run.go internal/agent/run_test.go app.go
git commit -m "feat: run query service and Wails bindings for review workflow"
```

---

## Task 4: Frontend Types & Review Store

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/stores/reviewStore.ts`
- Modify: `frontend/src/stores/overlayStore.ts`

- [ ] **Step 1: Add review types to types.ts**

Append to `frontend/src/lib/types.ts`:

```typescript
// Review types
export interface AgentRunWithStats {
  id: number;
  projectId: number;
  agentType: string;
  taskDescription: string;
  baseCommit: string;
  endCommit: string;
  status: string;
  startedAt: string;
  completedAt: string;
  agentId: string;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface RunFileChange {
  id: number;
  runId: number;
  filePath: string;
  changeType: string;
  additions: number;
  deletions: number;
}

export interface FileDiff {
  filePath: string;
  original: string;
  modified: string;
  changeType: string;
}
```

Update `PaneType`: `export type PaneType = 'terminal' | 'editor' | 'settings' | 'runHistory' | 'review';`

Add `runId?: number` to `PanelTab`.

- [ ] **Step 2: Create review store**

Create `frontend/src/stores/reviewStore.ts`:

```typescript
import { create } from 'zustand';

type FileDecision = 'pending' | 'accepted' | 'rejected';

interface ReviewState {
  runId: number | null;
  fileDecisions: Map<string, FileDecision>;
  activeFilePath: string | null;
  diffMode: 'side-by-side' | 'inline';

  setRun: (runId: number) => void;
  setDecision: (filePath: string, decision: FileDecision) => void;
  setActiveFile: (filePath: string) => void;
  toggleDiffMode: () => void;
  acceptAll: (filePaths: string[]) => void;
  rejectAll: (filePaths: string[]) => void;
  getAcceptedFiles: () => string[];
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  runId: null,
  fileDecisions: new Map(),
  activeFilePath: null,
  diffMode: 'side-by-side',

  setRun: (runId) => set({ runId, fileDecisions: new Map(), activeFilePath: null }),

  setDecision: (filePath, decision) => set((state) => {
    const decisions = new Map(state.fileDecisions);
    decisions.set(filePath, decision);
    return { fileDecisions: decisions };
  }),

  setActiveFile: (filePath) => set({ activeFilePath: filePath }),

  toggleDiffMode: () => set((state) => ({
    diffMode: state.diffMode === 'side-by-side' ? 'inline' : 'side-by-side',
  })),

  acceptAll: (filePaths) => set(() => {
    const decisions = new Map<string, FileDecision>();
    for (const fp of filePaths) {
      decisions.set(fp, 'accepted');
    }
    return { fileDecisions: decisions };
  }),

  rejectAll: (filePaths) => set(() => {
    const decisions = new Map<string, FileDecision>();
    for (const fp of filePaths) {
      decisions.set(fp, 'rejected');
    }
    return { fileDecisions: decisions };
  }),

  getAcceptedFiles: () => {
    return Array.from(get().fileDecisions.entries())
      .filter(([_, d]) => d === 'accepted')
      .map(([fp]) => fp);
  },

  reset: () => set({ runId: null, fileDecisions: new Map(), activeFilePath: null }),
}));
```

- [ ] **Step 3: Add 'commitReview' to overlayStore**

In `overlayStore.ts`, update the type to include `'commitReview'`.

- [ ] **Step 4: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/stores/reviewStore.ts frontend/src/stores/overlayStore.ts
git commit -m "feat: review types, review store, overlay update for commit modal"
```

---

## Task 5: Run History Panel

**Files:**
- Create: `frontend/src/components/review/RunHistory.tsx`

- [ ] **Step 1: Create RunHistory component**

A tab-based panel that lists completed agent runs for a project. Each row shows agent info, task, status, timing, and change stats. Clicking opens the review panel.

Props: `projectId: number`. On mount, calls `window.go.main.App.ListProjectRuns(projectId)`. Maps results to rows with relative timestamps (compute from `startedAt`), duration (compute from `startedAt` and `completedAt`), and change summary. Clicking a row calls `addTab` to open a review tab with the run's ID.

Status badges: green "Done" for `status === 'done'`, red "Error" for `status === 'error'`.

Empty state: "No agent runs yet. Start an agent with Ctrl+Shift+A"

Style: dark theme matching existing panels. Use `var(--bg-*)` and `var(--text-*)` variables.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/review/RunHistory.tsx
git commit -m "feat: run history panel showing completed agent runs"
```

---

## Task 6: Diff Viewer Component

**Files:**
- Create: `frontend/src/components/review/DiffViewer.tsx`

- [ ] **Step 1: Create DiffViewer component**

A wrapper around Monaco's `createDiffEditor`. Props:

```typescript
interface DiffViewerProps {
  original: string;
  modified: string;
  filePath: string;
  mode: 'side-by-side' | 'inline';
}
```

On mount: create `monaco.editor.createDiffEditor(container, { renderSideBySide: mode === 'side-by-side', readOnly: true, ... })`. Create original and modified models with language detected from file extension (reuse the `detectLanguage` pattern from `editorStore.ts`). Set the models on the diff editor.

On `filePath` or content change: update the models via `editor.setModel({ original: newOrigModel, modified: newModModel })`. Dispose old models.

On `mode` change: update `renderSideBySide` option via `editor.updateOptions()`.

On unmount: dispose editor and models. This is critical — Monaco diff editors are heavyweight.

Style: full width/height, dark theme (`vs-dark`), font: JetBrains Mono 14.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/review/DiffViewer.tsx
git commit -m "feat: Monaco diff viewer component with side-by-side/inline toggle"
```

---

## Task 7: File Change List & Run Review Layout

**Files:**
- Create: `frontend/src/components/review/FileChangeList.tsx`
- Create: `frontend/src/components/review/RunReview.tsx`

- [ ] **Step 1: Create FileChangeList**

Left panel component showing files changed in a run. For each file:
- File icon (by extension, reuse `fileIcon` pattern from `FileNode.tsx`)
- Relative file path
- Change type badge: "A" green, "M" orange, "D" red
- "+N -M" line counts
- Accept (checkmark) and reject (X) buttons
- Green tint if accepted, red tint + strikethrough if rejected, neutral if pending
- Accept button disabled for rejected files (show tooltip: "File was reverted")
- Clicking file row calls `reviewStore.setActiveFile(filePath)`
- Active file highlighted

Props: `files: RunFileChange[]`, `projectId: number`, `baseCommit: string`.

Accept handler: calls `reviewStore.setDecision(filePath, 'accepted')`.
Reject handler: calls `window.go.main.App.RevertFile(projectId, baseCommit, filePath, changeType)`. On success: `reviewStore.setDecision(filePath, 'rejected')`. On error: show error, leave as pending.

- [ ] **Step 2: Create RunReview**

The main review panel layout. Props: `runId: number`, `projectId: number`.

On mount: load run details via `GetRunFileChanges(runId)` and get the run info from `ListProjectRuns(projectId)` filtered by ID (or add a `GetRun` binding — simpler to just filter the list since it's already loaded).

Layout:
- Top bar: agent info + "Accept All" / "Reject All" / "Prev/Next" / "Commit Reviewed" buttons
- Left (30%): `<FileChangeList>`
- Right (70%): `<DiffViewer>` loading content via `GetFileDiff(projectId, baseCommit, endCommit, activeFilePath)`

"Commit Reviewed" button visible when `reviewStore.getAcceptedFiles().length > 0`. Opens the commit modal overlay.

"Accept All" calls `reviewStore.acceptAll(allFilePaths)`.
"Reject All" calls `RevertFile` for each file then `reviewStore.rejectAll(allFilePaths)`.

Prev/Next navigate through the file list.

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/review/FileChangeList.tsx frontend/src/components/review/RunReview.tsx
git commit -m "feat: file change list with accept/reject and run review layout"
```

---

## Task 8: Commit Modal

**Files:**
- Create: `frontend/src/components/review/CommitModal.tsx`

- [ ] **Step 1: Create CommitModal**

Modal triggered by `overlayStore.active === 'commitReview'`. Shows:
- Textarea with pre-populated message: `[{agentType}] {taskDescription}\n\nAgent-Run: {runId}`
- "Push after commit" checkbox (unchecked by default)
- Commit / Cancel buttons
- Error display area

On commit: calls `window.go.main.App.CommitReviewedChanges(projectId, message, acceptedFilePaths, push)`. On success: show success message, close modal, optionally reset review store.

Props read from review store + passed via context or props: `projectId`, `runId`, `agentType`, `taskDescription`, accepted files from `reviewStore.getAcceptedFiles()`.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/review/CommitModal.tsx
git commit -m "feat: commit modal with pre-populated message and push option"
```

---

## Task 9: Wire Into App & Pane

**Files:**
- Modify: `frontend/src/components/layout/Pane.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update Pane.tsx to render review tabs**

Import review components:
```typescript
import { RunHistory } from '../review/RunHistory';
import { RunReview } from '../review/RunReview';
```

Add render branches in the tab content area:
```tsx
{tab.type === 'runHistory' ? (
  <RunHistory projectId={tab.projectId!} />
) : tab.type === 'review' ? (
  <RunReview runId={tab.runId!} projectId={tab.projectId!} />
) : tab.type === 'settings' && tab.projectId ? (
  // ... existing settings case
```

- [ ] **Step 2: Add Ctrl+Shift+D shortcut in App.tsx**

Import `CommitModal`:
```typescript
import { CommitModal } from './components/review/CommitModal';
```

Add keyboard shortcut in the `switch` block:
```typescript
case 'D':
  e.preventDefault();
  // Open run history tab for active project
  if (activeProjectId) {
    addTab(focusedPaneId, {
      type: 'runHistory',
      title: 'Run History',
      projectId: activeProjectId,
    });
  }
  break;
```

Render `<CommitModal />` alongside other modals.

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Pane.tsx frontend/src/App.tsx
git commit -m "feat: wire run history and review tabs, Ctrl+Shift+D shortcut, commit modal"
```

---

## Task 10: Wails Bindings & Smoke Test

- [ ] **Step 1: Regenerate Wails bindings**

Run: `wails generate module`

- [ ] **Step 2: Run all Go tests**

Run: `go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 3: Build the full application**

Run: `wails build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for review workflow"
```

---

## Summary

10 tasks, ordered by dependency:

1. **Git helpers** — ShowFile, DiffNumstat (TDD, standalone)
2. **trackRun backfill** — capture additions/deletions via numstat
3. **Run query service** — ListProjectRuns, GetRunFileChanges, Wails bindings (TDD)
4. **Frontend types + stores** — review types, reviewStore, overlay update
5. **Run history panel** — list of completed runs
6. **Diff viewer** — Monaco createDiffEditor wrapper
7. **File change list + review layout** — accept/reject per file, two-section layout
8. **Commit modal** — pre-populated message with trailer
9. **Wire into app** — Pane.tsx, Ctrl+Shift+D, CommitModal
10. **Bindings + smoke test** — regenerate, full build

**Critical path:** 1 → 2 → 3 (backend), then 4 → 5 → 6 → 7 → 8 → 9 → 10 (frontend)
