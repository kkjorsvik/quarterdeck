# Phase 6: Git Integration — Design Spec

## Overview

Phase 5 built the review → commit workflow. Phase 6 adds deeper git integration: visual git status in the file tree, worktree management for isolated agent workspaces, branch operations, merge conflict resolution, git log, and stash support. Together these make it safe to run multiple agents on the same project simultaneously and manage their work through standard git workflows.

## Features

### 1. Git Status in File Tree

Show git status indicators on files and directories in the file tree sidebar.

**Refresh strategy:** Poll `git status --porcelain=v1` every 3 seconds for the active project, plus immediate refresh on file save and git operations. Background projects are not polled (status loaded on project switch).

**Backend:**

`App.GetGitStatus(projectID int64) ([]FileStatus, error)`:

```go
type FileStatus struct {
    Path     string `json:"path"`
    Status   string `json:"status"`   // "modified", "staged", "untracked", "deleted", "renamed", "conflicted"
    IsStaged bool   `json:"isStaged"`
}
```

Parses `git status --porcelain=v1` output:
- `M ` = staged modified → `{Status: "modified", IsStaged: true}`
- ` M` = unstaged modified → `{Status: "modified", IsStaged: false}`
- `MM` = staged + unstaged → `{Status: "modified", IsStaged: true}` (staged takes priority)
- `??` = untracked → `{Status: "untracked", IsStaged: false}`
- `A ` = staged new → `{Status: "staged", IsStaged: true}`
- `D ` / ` D` = deleted → `{Status: "deleted", IsStaged: ...}`
- `UU` / `AA` / `DD` = conflict → `{Status: "conflicted", IsStaged: false}`

**Frontend:**

Store `gitStatusMap: Map<string, FileStatus>` in the project store. Poll via `useEffect` with 3-second interval when project is active.

File tree indicators:
- Modified (unstaged): orange dot
- Staged: green dot
- Untracked: gray "U" badge
- Deleted: red strikethrough
- Conflicted: red "!" badge

Directory indicators: only shown for expanded directories (where children are loaded). Propagate the most urgent visible child status upward (conflicted > modified > staged > untracked). Collapsed directories show no git indicator — the file tree is lazy-loaded and computing status for collapsed dirs would require a full recursive traversal.

**Path format:** `gitStatusMap` uses paths relative to the project root (matching `git status --porcelain` output). `FileNode` converts its absolute `entry.path` to a relative path by stripping the project root prefix before looking up status.

**Refresh triggers (immediate, no wait for poll):**
- File save in editor
- After any git operation (commit, checkout, merge, stash)
- On project switch

### 2. Git Worktree Management

**Backend:** `internal/git/worktree.go`

```go
type Worktree struct {
    Path      string `json:"path"`
    Branch    string `json:"branch"`
    IsMain    bool   `json:"isMain"`
    CommitSHA string `json:"commitSha"`
    AgentID   string `json:"agentId"`
}

func ListWorktrees(repoPath string) ([]Worktree, error)
func CreateWorktree(repoPath, worktreePath, branchName string) error
func CreateWorktreeFromExisting(repoPath, worktreePath, branchName string) error
func RemoveWorktree(repoPath, worktreePath string, force bool) error
```

All shell out to `git worktree` CLI.

**Default worktree path:** `.worktrees/<branch>/` in the project root. Configurable per project (stored in project settings). On first worktree creation, auto-add `.worktrees/` to `.gitignore` if not already present.

**SQLite — new migration `004_worktrees.sql`** (migrations 002 and 003 already exist from Phases 3 and 4a):

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

**Wails bindings:**

```go
func (a *App) ListWorktrees(projectID int64) ([]git.Worktree, error)
func (a *App) CreateWorktree(projectID int64, branchName string) (string, error) // returns worktree path
func (a *App) RemoveWorktree(projectID int64, worktreePath string, force bool) error
func (a *App) AssignWorktreeAgent(worktreeID int64, agentID string) error
```

**Cleanup on project removal:** When removing a project, show warning if worktrees exist: "This project has N worktrees. Remove them too?" If yes, run `git worktree remove` for each, then `git worktree prune`. If no, leave them (user handles manually).

### 3. Agent Spawn Worktree Integration

**Modify spawn dialog:**

Add "Isolate in worktree" checkbox below the working directory field.
- Always visible, unchecked by default
- Auto-checked with yellow warning when another agent is already active on the same project: "Another agent is running on this project. Isolating in a worktree prevents file conflicts."
- When checked: auto-generates branch name `agent/<type>/<YYYYMMDD-HHmm>-<random4>` (e.g., `agent/claude-code/20260328-1430-a7f2`)

**Spawn sequence when worktree checked:**

The frontend orchestrates the two-phase flow. The existing `SpawnAgent` signature is unchanged — the frontend passes the worktree path as `workDir`.

1. Frontend calls `App.CreateWorktree(projectID, branchName)` → returns worktree path
2. If CreateWorktree fails → show error in dialog, no orphans created
3. Frontend calls `App.SpawnAgent(projectID, agentType, taskDesc, worktreePath, customCmd)` with the worktree path as `workDir`
4. If SpawnAgent fails → frontend calls `App.RemoveWorktree(projectID, worktreePath, true)` to clean up
5. If SpawnAgent succeeds → frontend calls a new `App.AssignWorktreeAgent(worktreeID, agentID)` to link the worktree DB row to the agent

This avoids modifying the SpawnAgent signature and handles rollback cleanly.

**Spawn sequence when worktree unchecked:** current behavior (agent runs in main project directory).

**Dirty tree warning:** When spawning without worktree isolation and the working tree has uncommitted changes, show inline yellow info bar in spawn dialog: "Working tree has uncommitted changes. Consider stashing first." with a "Stash Now" button. Clicking stashes with message `"Auto-stash before agent: <task-description>"`. Dismissing spawns normally.

### 4. Branch Management

**Backend:** `internal/git/branch.go`

```go
type Branch struct {
    Name         string `json:"name"`
    CommitSHA    string `json:"commitSha"`
    CommitMsg    string `json:"commitMsg"`
    IsCurrent    bool   `json:"isCurrent"`
    IsWorktree   bool   `json:"isWorktree"`   // checked out in another worktree
    AheadBehind  string `json:"aheadBehind"`  // e.g., "2 ahead, 1 behind"
}

type MergeResult struct {
    Success     bool     `json:"success"`
    HasConflict bool     `json:"hasConflict"`
    Message     string   `json:"message"`
    ConflictFiles []string `json:"conflictFiles"`
}

func ListBranches(repoPath string) ([]Branch, error)
func CreateBranch(repoPath, branchName, startPoint string) error
func SwitchBranch(repoPath, branchName string) error
func DeleteBranch(repoPath, branchName string, force bool) error
func MergeBranch(repoPath, branchName string) (*MergeResult, error)
func GetAheadBehind(repoPath, branch, upstream string) (int, int, error)
```

**Frontend — branch panel:**

Opens as a tab via `Ctrl+Shift+B` or clicking the branch name in the status bar.

Content:
- Current branch (bold, at top)
- Local branches list: name, abbreviated SHA, last commit message, date, ahead/behind
- Worktree branches marked with icon (tooltip: "Checked out in worktree")
- Action buttons per branch: Switch (disabled for worktree branches), Delete, Merge into current

Header actions: "New Branch" button (opens small modal with name + start point).

**Switch branch behavior:**
- Check if working tree is dirty first (`git status --porcelain`)
- If dirty, show confirmation: "You have uncommitted changes. Switch anyway? (Changes will be carried to the new branch)" with Switch / Cancel / Stash & Switch buttons
- After switch: refresh file tree, refresh all open editor tabs (reload content, close tabs for files that no longer exist), refresh git status

### 5. Merge from Worktree

After reviewing and committing agent work in a worktree branch:

1. "Merge to main" button appears in the run review panel (when the run was in a worktree) and in the worktree section of the branch panel
2. Confirm dialog: "Merge branch `agent/claude-code/20260328-1430-a7f2` into `main`?"
3. Execute `git merge <branch>` in the main worktree
4. **Success:** show message, offer to clean up ("Delete worktree and branch?")
5. **Conflicts:** transition to conflict resolution (Feature 6)

**Backend:**

```go
func (a *App) MergeWorktreeBranch(projectID int64, branchName string) (*git.MergeResult, error)
func (a *App) CleanupWorktree(projectID int64, worktreePath string, deleteBranch bool) error
```

`CleanupWorktree`: removes the worktree directory, runs `git worktree prune`, optionally deletes the branch, removes the `worktrees` DB row.

### 6. Merge Conflict Resolution

Simple marker-editing approach — show the conflict file list, user edits in Monaco, marks resolved per file.

**Backend:**

```go
func HasConflicts(repoPath string) (bool, error)
func ListConflictFiles(repoPath string) ([]string, error)
func MarkFileResolved(repoPath, filePath string) error  // git add <file>
func CompleteMerge(repoPath string) error               // git commit (no message needed, merge commit message is pre-populated by git)
func AbortMerge(repoPath string) error                  // git merge --abort
```

**Frontend — conflict panel:**

Opens automatically when a merge produces conflicts. Tab with `type: 'conflicts'`.

Content:
- Header: "Merge Conflicts — N files to resolve"
- File list showing conflicted files
- Click file → opens it in a regular editor tab (conflict markers visible in Monaco)
- Per-file "Mark Resolved" button (calls `git add`, grays out the file)
- "Complete Merge" button (enabled when all files resolved)
- "Abort Merge" button (reverts to pre-merge state)

User workflow: open file, edit conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`), save, click "Mark Resolved". Repeat for each file. Click "Complete Merge".

### 7. Git Log View

Opens as a tab via `Ctrl+Shift+L`.

**Backend:**

```go
type CommitInfo struct {
    SHA      string `json:"sha"`
    Message  string `json:"message"`
    Author   string `json:"author"`
    Date     string `json:"date"`
    AgentRun *int64 `json:"agentRun"` // parsed from Agent-Run trailer, nil if not agent commit
}

func GetLog(repoPath string, limit, offset int) ([]CommitInfo, error)
func GetCommitFileChanges(repoPath, commitSHA string) ([]FileChange, error)
func GetCommitFileDiff(repoPath, commitSHA, filePath string) (*FileDiff, error)
```

`GetLog`: `git log --format=...` with limit/offset pagination. Parses `Agent-Run:` trailer.
`GetCommitFileChanges`: `git diff-tree -r --name-status <sha>` for file list.
`GetCommitFileDiff`: `git show <sha>:<path>` for modified, `git show <sha>^:<path>` for original.

**Frontend:**

Commit list (50 at a time, "Load more" button). Each row: SHA (7 chars), message, author, relative date. Agent commits show badge linking to run history.

Click commit → expands to show file change list (reuses `FileChangeList` in read-only mode). Click file → loads diff in `DiffViewer`.

### 8. Stash Support

**Backend:** `internal/git/stash.go`

```go
type StashEntry struct {
    Index   int    `json:"index"`
    Message string `json:"message"`
    Date    string `json:"date"`
}

func StashPush(repoPath, message string) error
func StashList(repoPath string) ([]StashEntry, error)
func StashPop(repoPath string, index int) error
func StashDrop(repoPath string, index int) error
```

**Frontend:**

Stash button in status bar (visible when working tree is dirty). Clicking opens a stash modal/panel:
- "Stash Changes" with optional message field
- Stash list showing saved stashes with message and date
- "Pop" and "Drop" buttons per entry
- Pop warns if working tree is dirty

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+B` | Branch panel |
| `Ctrl+Shift+L` | Git log |

Existing: `Ctrl+Shift+G` (working tree diff), `Ctrl+Shift+D` (run history)

## Backend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/git/status.go` | Create | GetStatus (porcelain parser) |
| `internal/git/status_test.go` | Create | Tests for status parsing |
| `internal/git/worktree.go` | Create | ListWorktrees, CreateWorktree, RemoveWorktree |
| `internal/git/worktree_test.go` | Create | Worktree tests with temp repos |
| `internal/git/branch.go` | Create | ListBranches, CreateBranch, SwitchBranch, DeleteBranch, MergeBranch |
| `internal/git/branch_test.go` | Create | Branch tests with temp repos |
| `internal/git/log.go` | Create | GetLog, GetCommitFileChanges, GetCommitFileDiff |
| `internal/git/log_test.go` | Create | Log tests with temp repos |
| `internal/git/stash.go` | Create | StashPush, StashList, StashPop, StashDrop |
| `internal/git/stash_test.go` | Create | Stash tests |
| `internal/git/conflict.go` | Create | HasConflicts, ListConflictFiles, MarkFileResolved, CompleteMerge, AbortMerge |
| `internal/git/conflict_test.go` | Create | Conflict tests |
| `internal/db/migrations/004_worktrees.sql` | Create | Worktrees table |
| `app.go` | Modify | All new Wails bindings |

## Frontend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add FileStatus, Worktree, Branch, MergeResult, CommitInfo, StashEntry, new PaneTypes |
| `frontend/src/stores/projectStore.ts` | Modify | Add gitStatusMap, pollGitStatus |
| `frontend/src/components/filetree/FileNode.tsx` | Modify | Show git status indicators |
| `frontend/src/components/sidebar/SpawnAgentModal.tsx` | Modify | Worktree checkbox, dirty warning, stash button |
| `frontend/src/components/git/BranchPanel.tsx` | Create | Branch list, create, switch, delete, merge |
| `frontend/src/components/git/ConflictPanel.tsx` | Create | Conflict file list, mark resolved, complete/abort merge |
| `frontend/src/components/git/GitLog.tsx` | Create | Commit log with on-demand diff |
| `frontend/src/components/git/StashPanel.tsx` | Create | Stash list, push, pop, drop |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render new tab types (branch, conflicts, gitLog) |
| `frontend/src/components/layout/StatusBar.tsx` | Modify | Stash button, branch click opens panel |
| `frontend/src/App.tsx` | Modify | Ctrl+Shift+B, Ctrl+Shift+L shortcuts |

## Edge Cases

**Not a git repo:** All git operations return errors gracefully. File tree shows no status indicators. Worktree/branch/stash features disabled (buttons hidden or grayed out). The file tree, editor, and terminals still work.

**Worktree creation fails (branch already exists):** Return error to frontend, show in spawn dialog. User can pick a different branch name.

**Worktree cleanup with uncommitted changes:** `RemoveWorktree` with `force=false` fails if worktree has uncommitted changes. Show confirmation: "Worktree has uncommitted changes. Force remove?" If yes, retry with `force=true`.

**Branch switch with open editors:** After `git checkout`, some open files may no longer exist or have different content. Refresh: reload content for files that still exist, close tabs for files that don't, refresh file tree.

**Merge conflict in non-text file:** Binary files can conflict too. Show "Binary file conflict — resolve manually" in the conflict panel. User must resolve outside Quarterdeck and mark resolved.

**Agent in worktree finishes, worktree deleted, then user opens run review:** The diff viewer uses `git show <commit>:<path>` which works from the main repo — worktree deletion doesn't affect git history. Diffs still work.

**Review/commit in worktree context:** The existing `CommitReviewedChanges` and `RevertFile` bindings use `projectID` to look up `project.Path`. For worktree-based runs, these operations must use the worktree path, not the project root. Modify these bindings to accept an optional `workDir` override parameter. The run review panel passes the agent's `WorkDir` (which is the worktree path for worktree-based agents, or the project path for non-worktree agents).

**Renamed file diffs in git log:** `GetCommitFileDiff` uses `git show <sha>:<path>` for the modified content and `git show <sha>^:<path>` for the original. For renamed files, the old name differs from the new name. Use `git diff-tree -r -M <sha>` to discover renames (returns `R<score>\told\tnew`), then use `git show <sha>^:<old-name>` for the original content.

**Unsaved editor changes on branch switch:** Before switching branches, check if any open editor tabs have `modified: true`. If so, show warning: "You have unsaved changes in N files. Save them before switching?" with Save All / Discard / Cancel buttons.

**Stash pop with conflicts:** If `git stash pop` produces merge conflicts, git leaves the conflict state in the working tree without dropping the stash. Show the conflict resolution panel. Note that the stash is NOT dropped in this case — the user must resolve conflicts first, then the stash can be manually dropped.

**Git status poll during long operation:** If `git status` runs during a large merge or rebase, it might return unexpected results. The 3-second poll interval and debouncing handle this — the next poll will show the correct state.

## Technical Notes

- All git operations shell out to `git` CLI. No Go git library.
- Git status polling: 3-second interval for active project only. Debounce: skip poll if previous poll hasn't completed. Immediate refresh on save/git-ops cancels the current poll timer and starts fresh.
- Branch switch refreshes: file tree reload, editor tab content reload, git status refresh, status bar branch update.
- Worktree branch naming: `agent/<type>/<YYYYMMDD-HHmm>-<random4>` ensures uniqueness. The random suffix handles same-second spawns.
- `.worktrees/` gitignore: check before each worktree creation, add if missing. Use `echo '.worktrees/' >> .gitignore` only if not already present.
- The conflict panel type is `'conflicts'` added to PaneType. It auto-opens when a merge fails.
- `GetLog` uses `--format` to parse trailers. The `Agent-Run:` trailer links commits to run history.
- Stash operations refresh git status immediately after.
- Worktree auto-check: queries the in-memory agent store (`agentStore.getProjectAgents`). If two agents are spawned in quick succession before the first is detected, both may bypass the auto-check. This is acceptable — the checkbox is always available for manual selection.
- Git log pagination: when `len(results) < limit`, the frontend hides "Load more" (no more commits). No total count needed.
- `.gitignore` mutation: check-then-append is not atomic. Use a simple file lock or accept the rare duplicate entry (harmless). Not worth a mutex for this.
- All Go backend code gets tests using temp git repos.
