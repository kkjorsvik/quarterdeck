# Git Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git visibility (status in file tree), worktree management for isolated agent workspaces, branch operations, merge conflict resolution, git log, and stash support.

**Architecture:** All git operations shell out to `git` CLI via helper functions in `internal/git/`. Frontend polls git status every 3 seconds for the active project. Worktrees stored in `.worktrees/` relative to project root. Branch/conflict/log/stash operations exposed via Wails bindings.

**Tech Stack:** Go 1.25, git CLI, SQLite, React 18, Zustand, Monaco Editor, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-28-git-integration-design.md`

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/git/status.go` | Create | GetStatus porcelain parser |
| `internal/git/status_test.go` | Create | Status parsing tests |
| `internal/git/worktree.go` | Create | ListWorktrees, CreateWorktree, RemoveWorktree |
| `internal/git/worktree_test.go` | Create | Worktree tests |
| `internal/git/branch.go` | Create | ListBranches, CreateBranch, SwitchBranch, DeleteBranch, MergeBranch |
| `internal/git/branch_test.go` | Create | Branch tests |
| `internal/git/conflict.go` | Create | HasConflicts, ListConflictFiles, MarkFileResolved, CompleteMerge, AbortMerge |
| `internal/git/conflict_test.go` | Create | Conflict tests |
| `internal/git/log.go` | Create | GetLog, GetCommitFileChanges, GetCommitFileDiff |
| `internal/git/log_test.go` | Create | Log tests |
| `internal/git/stash.go` | Create | StashPush, StashList, StashPop, StashDrop |
| `internal/git/stash_test.go` | Create | Stash tests |
| `internal/db/migrations/004_worktrees.sql` | Create | Worktrees table |
| `app.go` | Modify | All new Wails bindings |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add git types, new PaneTypes |
| `frontend/src/stores/projectStore.ts` | Modify | gitStatusMap, pollGitStatus, refreshGitStatus |
| `frontend/src/components/filetree/FileNode.tsx` | Modify | Git status indicators |
| `frontend/src/components/git/BranchPanel.tsx` | Create | Branch list + operations |
| `frontend/src/components/git/ConflictPanel.tsx` | Create | Conflict resolution UI |
| `frontend/src/components/git/GitLog.tsx` | Create | Commit log with on-demand diff |
| `frontend/src/components/git/StashPanel.tsx` | Create | Stash list + operations |
| `frontend/src/components/sidebar/SpawnAgentModal.tsx` | Modify | Worktree checkbox, dirty warning |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render new tab types |
| `frontend/src/components/layout/StatusBar.tsx` | Modify | Branch click, stash button |
| `frontend/src/App.tsx` | Modify | Ctrl+Shift+B, Ctrl+Shift+L |

---

## Part A: Git Infrastructure & Visibility

### Task 1: Git Status Backend (TDD)

**Files:**
- Create: `internal/git/status.go`
- Create: `internal/git/status_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/git/status_test.go` with tests:
- `TestGetStatus` — create temp repo, modify a file, add a new file, verify status returns correct entries
- `TestGetStatusUntracked` — untracked file shows as "untracked"
- `TestGetStatusStaged` — staged file shows `IsStaged: true`
- `TestGetStatusEmpty` — clean repo returns empty slice

Use the existing `initTestRepo` helper pattern from `git_test.go`.

- [ ] **Step 2: Implement GetStatus**

Create `internal/git/status.go`:

```go
package git

import (
    "fmt"
    "os/exec"
    "strings"
)

type FileStatus struct {
    Path     string `json:"path"`
    Status   string `json:"status"`
    IsStaged bool   `json:"isStaged"`
}

func GetStatus(repoPath string) ([]FileStatus, error) {
    cmd := exec.Command("git", "status", "--porcelain=v1")
    cmd.Dir = repoPath
    out, err := cmd.Output()
    if err != nil {
        return nil, fmt.Errorf("git status: %w", err)
    }
    return parsePorcelainStatus(string(out)), nil
}

func parsePorcelainStatus(output string) []FileStatus {
    var statuses []FileStatus
    for _, line := range strings.Split(output, "\n") {
        if len(line) < 4 { continue }
        x, y := line[0], line[1]
        path := line[3:]
        if idx := strings.Index(path, " -> "); idx >= 0 {
            path = path[idx+4:]
        }

        var status string
        var isStaged bool

        switch {
        case x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D'):
            status = "conflicted"
        case x == '?':
            status = "untracked"
        case x == 'A':
            status = "staged"
            isStaged = true
        case x == 'D' || y == 'D':
            status = "deleted"
            isStaged = x == 'D'
        case x == 'R':
            status = "renamed"
            isStaged = true
        case x == 'M' || y == 'M':
            status = "modified"
            isStaged = x == 'M'
        default:
            status = "modified"
        }
        statuses = append(statuses, FileStatus{Path: path, Status: status, IsStaged: isStaged})
    }
    return statuses
}
```

- [ ] **Step 3: Run tests, add Wails binding**

Run: `go test ./internal/git/ -v -run TestGetStatus`

Add to `app.go`:
```go
func (a *App) GetGitStatus(projectID int64) ([]gitPkg.FileStatus, error) {
    project, err := a.projects.Get(projectID)
    if err != nil { return nil, err }
    return gitPkg.GetStatus(project.Path)
}
```

- [ ] **Step 4: Commit**

```bash
git add internal/git/status.go internal/git/status_test.go app.go
git commit -m "feat: git status porcelain parser with Wails binding"
```

---

### Task 2: Git Status in File Tree (Frontend)

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/stores/projectStore.ts`
- Modify: `frontend/src/components/filetree/FileNode.tsx`

- [ ] **Step 1: Add types**

Add to `types.ts`:
```typescript
export interface FileStatus {
    path: string;
    status: 'modified' | 'staged' | 'untracked' | 'deleted' | 'renamed' | 'conflicted';
    isStaged: boolean;
}
```

Add `'branch' | 'conflicts' | 'gitLog'` to PaneType.

- [ ] **Step 2: Add git status polling to projectStore**

Add to projectStore:
- `gitStatusMap: Map<string, FileStatus>` state
- `pollGitStatus()` method — calls `GetGitStatus(activeProjectId)`, populates map keyed by relative path
- `refreshGitStatus()` — immediate refresh (cancels poll timer, fetches, restarts timer)

In `Sidebar.tsx` or `App.tsx`, add a 3-second polling interval for the active project. Call `refreshGitStatus` on file save.

- [ ] **Step 3: Update FileNode with git indicators**

In `FileNode.tsx`:
- Import `useProjectStore`
- Get `gitStatusMap` from store
- For each file: compute relative path by stripping the project root from `entry.path`
- Look up status in map
- Render indicator: orange dot for modified, green dot for staged, gray "U" for untracked, red strikethrough for deleted, red "!" for conflicted
- For directories (when expanded): compute aggregate status from visible children

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: git status indicators in file tree with 3-second polling"
```

---

### Task 3: Worktree Backend (TDD)

**Files:**
- Create: `internal/git/worktree.go`
- Create: `internal/git/worktree_test.go`
- Create: `internal/db/migrations/004_worktrees.sql`

- [ ] **Step 1: Create migration**

```sql
CREATE TABLE IF NOT EXISTS worktrees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    is_main BOOLEAN DEFAULT 0,
    agent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON worktrees(agent_id);
```

- [ ] **Step 2: Write failing tests**

Tests for: `ListWorktrees`, `CreateWorktree`, `RemoveWorktree`. Create temp git repos, create worktrees, verify list output, remove and verify.

- [ ] **Step 3: Implement worktree helpers**

Create `internal/git/worktree.go` with `ListWorktrees` (parses `git worktree list --porcelain`), `CreateWorktree` (`git worktree add -b`), `CreateWorktreeFromExisting`, `RemoveWorktree`.

- [ ] **Step 4: Add Wails bindings**

Add to `app.go`: `ListWorktrees`, `CreateWorktree` (creates worktree + DB row, returns path), `RemoveWorktree` (removes worktree + DB row), `AssignWorktreeAgent`.

Auto-add `.worktrees/` to `.gitignore` in `CreateWorktree` if not present.

- [ ] **Step 5: Run tests, commit**

```bash
git add internal/git/worktree.go internal/git/worktree_test.go internal/db/migrations/004_worktrees.sql app.go
git commit -m "feat: git worktree management with SQLite tracking"
```

---

### Task 4: Branch Backend (TDD)

**Files:**
- Create: `internal/git/branch.go`
- Create: `internal/git/branch_test.go`

- [ ] **Step 1: Write failing tests**

Tests for: `ListBranches`, `CreateBranch`, `SwitchBranch`, `DeleteBranch`, `MergeBranch` (success case), `GetAheadBehind`.

- [ ] **Step 2: Implement branch helpers**

```go
func ListBranches(repoPath string) ([]Branch, error)     // git branch -v --format=...
func CreateBranch(repoPath, name, startPoint string) error // git checkout -b
func SwitchBranch(repoPath, name string) error             // git checkout
func DeleteBranch(repoPath, name string, force bool) error // git branch -d/-D
func MergeBranch(repoPath, name string) (*MergeResult, error) // git merge, check exit code + conflicts
func GetAheadBehind(repoPath, branch, upstream string) (int, int, error) // git rev-list --left-right --count
```

`MergeBranch` returns `MergeResult{Success, HasConflict, Message, ConflictFiles}`. On conflict, it parses `git diff --name-only --diff-filter=U`.

- [ ] **Step 3: Add Wails bindings**

Add: `ListBranches`, `CreateBranch`, `SwitchBranch`, `DeleteBranch`, `MergeBranch`, `MergeWorktreeBranch`, `CleanupWorktree`.

- [ ] **Step 4: Run tests, commit**

```bash
git add internal/git/branch.go internal/git/branch_test.go app.go
git commit -m "feat: branch management helpers with merge support"
```

---

### Task 5: Conflict, Log, Stash Backends (TDD)

**Files:**
- Create: `internal/git/conflict.go`, `internal/git/conflict_test.go`
- Create: `internal/git/log.go`, `internal/git/log_test.go`
- Create: `internal/git/stash.go`, `internal/git/stash_test.go`

- [ ] **Step 1: Implement conflict helpers**

```go
func HasConflicts(repoPath string) (bool, error)
func ListConflictFiles(repoPath string) ([]string, error)
func MarkFileResolved(repoPath, filePath string) error    // git add <file>
func CompleteMerge(repoPath string) error                  // git commit --no-edit
func AbortMerge(repoPath string) error                     // git merge --abort
```

Tests: create merge conflict in temp repo, verify detection, resolve, complete.

- [ ] **Step 2: Implement log helpers**

```go
func GetLog(repoPath string, limit, offset int) ([]CommitInfo, error)
func GetCommitFileChanges(repoPath, sha string) ([]FileChange, error)
func GetCommitFileDiff(repoPath, sha, filePath string) (*FileDiff, error)
```

`GetLog` uses `git log --format='%H||%s||%an||%aI||%(trailers:key=Agent-Run,valueonly)'` with `--no-walk` for parsing. Split by `||` delimiter. Parse `Agent-Run` trailer into `*int64`.

`GetCommitFileDiff`: uses `git show <sha>:<path>` and `git show <sha>^:<path>`. For renames, use `git diff-tree -r -M <sha>` to find old name.

Tests: create commits in temp repo, verify log output, file changes, diffs.

- [ ] **Step 3: Implement stash helpers**

```go
func StashPush(repoPath, message string) error
func StashList(repoPath string) ([]StashEntry, error)
func StashPop(repoPath string, index int) error
func StashDrop(repoPath string, index int) error
```

Tests: stash changes, verify list, pop, drop.

- [ ] **Step 4: Add all Wails bindings**

Add: `HasConflicts`, `ListConflictFiles`, `MarkFileResolved`, `CompleteMerge`, `AbortMerge`, `GetLog`, `GetCommitFileChanges`, `GetCommitFileDiff`, `StashPush`, `StashList`, `StashPop`, `StashDrop`.

- [ ] **Step 5: Run all tests, commit**

```bash
git add internal/git/conflict.go internal/git/conflict_test.go internal/git/log.go internal/git/log_test.go internal/git/stash.go internal/git/stash_test.go app.go
git commit -m "feat: conflict resolution, git log, and stash helpers"
```

---

## Part B: Frontend Git UI

### Task 6: Frontend Types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add all git types**

```typescript
export interface Worktree { path: string; branch: string; isMain: boolean; commitSha: string; agentId: string; }
export interface Branch { name: string; commitSha: string; commitMsg: string; isCurrent: boolean; isWorktree: boolean; aheadBehind: string; }
export interface MergeResult { success: boolean; hasConflict: boolean; message: string; conflictFiles: string[]; }
export interface CommitInfo { sha: string; message: string; author: string; date: string; agentRun: number | null; }
export interface StashEntry { index: number; message: string; date: string; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: git integration frontend types"
```

---

### Task 7: Branch Panel

**Files:**
- Create: `frontend/src/components/git/BranchPanel.tsx`

- [ ] **Step 1: Create BranchPanel**

Props: `projectId: number`. On mount loads branches via `ListBranches`.

Shows: current branch bold at top, list of branches with SHA, message, ahead/behind. Worktree branches have icon. Per-branch actions: Switch (with dirty warning), Delete (with confirmation), Merge.

"New Branch" button opens inline form (name + optional start point).

Switch: check dirty tree first via `GetGitStatus`. If dirty, confirm dialog. After switch: call `refreshGitStatus()` from project store.

Merge: calls `MergeBranch`, shows result. If conflicts, opens conflict panel tab.

- [ ] **Step 2: Verify frontend builds, commit**

```bash
git add frontend/src/components/git/BranchPanel.tsx
git commit -m "feat: branch management panel"
```

---

### Task 8: Conflict Panel

**Files:**
- Create: `frontend/src/components/git/ConflictPanel.tsx`

- [ ] **Step 1: Create ConflictPanel**

Props: `projectId: number`. On mount loads conflict files via `ListConflictFiles`.

Shows file list. Click file → opens in editor via `addTab` (regular editor tab — user sees conflict markers). "Mark Resolved" per file calls `MarkFileResolved`, grays out file. "Complete Merge" calls `CompleteMerge` (enabled when all resolved). "Abort Merge" calls `AbortMerge`.

- [ ] **Step 2: Verify frontend builds, commit**

```bash
git add frontend/src/components/git/ConflictPanel.tsx
git commit -m "feat: merge conflict resolution panel"
```

---

### Task 9: Git Log

**Files:**
- Create: `frontend/src/components/git/GitLog.tsx`

- [ ] **Step 1: Create GitLog**

Props: `projectId: number`. On mount loads 50 commits via `GetLog`.

Commit list: SHA (7 chars), message, author, relative date. Agent commits show badge. "Load more" button when `results.length === limit`.

Click commit → expand to show file change list (load via `GetCommitFileChanges`). Reuse `FileChangeList` in read-only mode. Click file → load diff via `GetCommitFileDiff`, show in `DiffViewer`.

- [ ] **Step 2: Verify frontend builds, commit**

```bash
git add frontend/src/components/git/GitLog.tsx
git commit -m "feat: git log panel with on-demand commit diffs"
```

---

### Task 10: Stash Panel

**Files:**
- Create: `frontend/src/components/git/StashPanel.tsx`
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Create StashPanel**

Small modal/panel for stash operations. "Stash Changes" with message field. List of stashes with Pop/Drop buttons. Pop warns if dirty.

- [ ] **Step 2: Add stash button to StatusBar**

Show "Stash" button in status bar when `gitStatusMap.size > 0` (working tree has changes). Clicking opens the stash panel as a modal or tab.

- [ ] **Step 3: Verify frontend builds, commit**

```bash
git add frontend/src/components/git/StashPanel.tsx frontend/src/components/layout/StatusBar.tsx
git commit -m "feat: stash panel with status bar integration"
```

---

### Task 11: Agent Spawn Worktree Integration

**Files:**
- Modify: `frontend/src/components/sidebar/SpawnAgentModal.tsx`

- [ ] **Step 1: Add worktree checkbox + dirty warning**

Add "Isolate in worktree" checkbox. Auto-check when project has active agents (check `agentStore`).

When checked: generate branch name, call `CreateWorktree` before `SpawnAgent`, pass worktree path as `workDir`. On spawn failure, call `RemoveWorktree` for cleanup. On success, call `AssignWorktreeAgent`.

Add dirty tree warning: check `GetGitStatus`, if results non-empty show yellow bar with "Stash Now" button.

- [ ] **Step 2: Verify frontend builds, commit**

```bash
git add frontend/src/components/sidebar/SpawnAgentModal.tsx
git commit -m "feat: worktree isolation option in agent spawn dialog"
```

---

### Task 12: Wire Into App & Pane

**Files:**
- Modify: `frontend/src/components/layout/Pane.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add tab rendering for new types**

In `Pane.tsx`, add render branches for `branch`, `conflicts`, `gitLog` tab types. Import BranchPanel, ConflictPanel, GitLog.

- [ ] **Step 2: Add keyboard shortcuts**

In `App.tsx`:
- `Ctrl+Shift+B` → open branch panel tab
- `Ctrl+Shift+L` → open git log tab

- [ ] **Step 3: Verify frontend builds, commit**

```bash
git add frontend/src/components/layout/Pane.tsx frontend/src/App.tsx
git commit -m "feat: wire git panels into Pane, Ctrl+Shift+B/L shortcuts"
```

---

### Task 13: Wails Bindings & Smoke Test

- [ ] **Step 1: Regenerate Wails bindings**

Run: `wails generate module`

- [ ] **Step 2: Run all Go tests**

Run: `go test ./... -v -timeout 60s`

- [ ] **Step 3: Full Wails build**

Run: `wails build`

- [ ] **Step 4: Commit**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for git integration"
```

---

## Summary

13 tasks split into two parts:

**Part A — Backend (Tasks 1-5):**
1. Git status backend (TDD)
2. Git status in file tree (frontend)
3. Worktree management (TDD + migration)
4. Branch management (TDD)
5. Conflict + log + stash backends (TDD)

**Part B — Frontend (Tasks 6-13):**
6. Frontend types
7. Branch panel
8. Conflict panel
9. Git log
10. Stash panel + status bar
11. Agent spawn worktree integration
12. Wire into App + Pane
13. Bindings + smoke test

**Critical path:** 1 → 2 (file tree status), 3 → 4 → 5 (backend infrastructure), then 6 → 7-11 (frontend, mostly independent) → 12 → 13
