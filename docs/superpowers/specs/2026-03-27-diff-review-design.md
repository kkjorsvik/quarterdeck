# Phase 5a: Diff & Code Review — Design Spec

## Overview

Phase 4 tracks agent runs and captures git diffs. Phase 5a builds the review workflow — the UI for viewing what agents changed, accepting or rejecting individual file changes, and committing reviewed work.

**Scope (Phase 5a):** Run history panel, run review with Monaco diff editor, per-file accept/reject, commit from review. Quick diff access, working tree diff, and diff navigation keybindings are deferred to Phase 5b.

## Architecture

### Diff Source: Frozen at Run Time

The diff viewer shows exactly what the agent changed — original content from `git show <base_commit>:<filepath>`, modified content from `git show <end_commit>:<filepath>`. This is frozen to the run's commits, not the current disk state. The user reviews precisely the agent's work, unaffected by subsequent changes.

### Accept/Reject Model

Accept is a UI-only state — it marks which files to include in the commit. Reject calls `git checkout <base_commit> -- <filepath>` to revert the file in the working tree, creating an uncommitted change that undoes the agent's work. The user then commits the accepted files, which produces a clean commit containing only the approved changes.

Review state (`pending`/`accepted`/`rejected` per file) is ephemeral — stored in a frontend store, not persisted to DB. Closing the review tab resets the state.

### Backfill: Capture Diff Stats

Phase 4b's `trackRun` currently stores `file_path` and `change_type` in `run_file_changes` but not `additions`/`deletions`. These columns exist in the schema. Update `trackRun` to capture line counts via `git diff --numstat` so the run history can show change summaries instantly.

## Features

### 1. Run History Panel

Opens as a tab via `Ctrl+Shift+D` or right-click agent → "View Run History".

**Content:** list of completed agent runs for the active project, newest first.

**Each run row:**
- Agent type icon + display name
- Task description (truncated, full on hover)
- Status badge: done (green), error (red)
- Relative timestamp ("2 hours ago") + duration ("ran for 4m 32s")
- Change summary: "+142 -38 across 7 files"
- Base commit SHA (first 7 chars)

**Click:** opens the run review panel for that run.

**Empty state:** "No agent runs yet. Start an agent with Ctrl+Shift+A"

**Backend:**

`App.ListProjectRuns(projectID int64) ([]AgentRunWithStats, error)`:
```sql
SELECT
    ar.id, ar.project_id, ar.agent_type, ar.task_description,
    ar.base_commit, ar.end_commit, ar.status,
    ar.started_at, ar.completed_at, ar.agent_id,
    COUNT(rfc.id) as file_count,
    COALESCE(SUM(rfc.additions), 0) as total_additions,
    COALESCE(SUM(rfc.deletions), 0) as total_deletions
FROM agent_runs ar
LEFT JOIN run_file_changes rfc ON rfc.run_id = ar.id
WHERE ar.project_id = ?
GROUP BY ar.id
ORDER BY ar.started_at DESC
```

`AgentRunWithStats` struct:
```go
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
```

### 2. Run Review Panel

Opens as a tab when clicking a run from history. Two-section layout.

**Left section (30%) — File Change List:**
- Each file: icon (by extension), relative path, change type badge (A green, M orange, D red), "+N -M"
- Sorted: modified first, then added, then deleted
- Clicking a file loads its diff in the right section
- Active file highlighted
- Per-file accept/reject buttons (see Feature 3)

**Right section (70%) — Monaco Diff Editor:**
- `monaco.editor.createDiffEditor(container, options)` in side-by-side mode
- `originalModel`: content from `git show <base_commit>:<filepath>`
- `modifiedModel`: content from `git show <end_commit>:<filepath>`
- Language auto-detected from file extension
- Read-only (no editing in diff view)
- Toggle button for inline vs side-by-side mode
- Header: file path, change type, "+N -M"

**Top bar:**
- Agent type icon + task description
- Run duration and timestamp
- "Accept All" / "Reject All" buttons
- "← Prev" / "Next →" file navigation
- "Commit Reviewed" button (appears when any file is accepted)

**Backend:**

`App.GetRunFileChanges(runID int64) ([]RunFileChange, error)`:
```go
type RunFileChange struct {
    ID         int64  `json:"id"`
    RunID      int64  `json:"runId"`
    FilePath   string `json:"filePath"`
    ChangeType string `json:"changeType"`
    Additions  int    `json:"additions"`
    Deletions  int    `json:"deletions"`
}
```

`App.GetFileDiff(projectID int64, baseCommit, endCommit, filePath string) (*FileDiff, error)`:
```go
type FileDiff struct {
    FilePath   string `json:"filePath"`
    Original   string `json:"original"`
    Modified   string `json:"modified"`
    ChangeType string `json:"changeType"`
}
```

Uses `git.ShowFile(repoPath, commitRef, filePath)` for both sides. New file → empty original. Deleted file → empty modified.

**New git helper:**
```go
// internal/git/git.go
func ShowFile(repoPath, commitRef, filePath string) (string, error)
// Runs: git show <commitRef>:<filePath>
```

### 3. Per-File Accept/Reject

**Accept:** marks file as accepted in the review store (green tint on the file row). No git action — just a UI state that determines which files get committed.

**Reject:** reverts the file to its `base_commit` version:
- Modified file: `git checkout <base_commit> -- <filepath>`
- New file (agent added): `os.Remove(filepath)`
- Deleted file (agent deleted): `git checkout <base_commit> -- <filepath>` (restores it)

File row gets red tint + strikethrough after reject.

**Backend bindings:**
```go
func (a *App) RevertFile(projectID int64, baseCommit, filePath, changeType string) error
```

Looks up project path from `projectID` (consistent with other bindings). This single method handles all cases:
- `changeType == "A"`: `os.Remove(filepath.Join(projectPath, filePath))` — note: must join project path with relative file path
- `changeType == "M"` or `changeType == "D"`: `git checkout <base_commit> -- <filepath>`

**Error handling:** If `git checkout` or `os.Remove` fails, return the error to the frontend. The UI shows an error toast and leaves the file's decision as `pending` (does not mark it as rejected).

**Frontend review store:**
```typescript
// stores/reviewStore.ts
interface ReviewState {
    runId: number | null;
    fileDecisions: Map<string, 'pending' | 'accepted' | 'rejected'>;
    activeFilePath: string | null;
    diffMode: 'side-by-side' | 'inline';

    setRun: (runId: number) => void;
    setDecision: (filePath: string, decision: 'accepted' | 'rejected') => void;
    setActiveFile: (filePath: string) => void;
    toggleDiffMode: () => void;
    acceptAll: () => void;
    rejectAll: () => void;  // UI-only: marks all as rejected. The component layer calls RevertFile for each file.
    getAcceptedFiles: () => string[];
    reset: () => void;
}
```

### 4. Commit from Review

**Trigger:** "Commit Reviewed" button in the run review top bar, enabled when at least one file is accepted.

**Commit modal:**
- Pre-populated message: `[agent-type] task description\n\nAgent-Run: <run_id>` (blank line before trailer — required for git trailer parsing)
- Message is editable
- "Push after commit" checkbox (unchecked by default)
- "Commit" and "Cancel" buttons

**Backend:**
```go
func (a *App) CommitReviewedChanges(projectPath, message string, filePaths []string, push bool) (string, error)
```

Sequence:
1. `git add <filepath>` for each accepted file
2. `git commit -m <message>`
3. If push: `git push`
4. Return the new commit SHA

**After commit:**
- Show success message in the review panel
- Optionally close the review tab
- The run's data in the DB doesn't need updating — the original `end_commit` records what the agent did, the new commit is the user's reviewed version

## Backfill: Diff Stats in trackRun

**Modify:** `internal/agent/manager.go` — `trackRun` method

Currently `trackRun` stores `file_path` and `change_type` but not `additions`/`deletions`. Add a `git diff --numstat` call to capture line counts.

For committed changes (`base_commit != end_commit`):
```go
// git diff --numstat <base> <end>
// Output: "42\t10\tpath/to/file.go" (additions, deletions, path)
```

For uncommitted changes:
```go
// git diff --numstat HEAD
```

Parse the output and populate the `additions`/`deletions` columns in `run_file_changes`.

**Integration with trackRun:** `trackRun` already calls `DiffFileList` or `DiffWorkingTree` to get the file list, then inserts rows. Add a second call to `DiffNumstat` (or `DiffNumstatWorkingTree`), key the results by filepath, and look up additions/deletions when inserting each `run_file_changes` row. Files not found in numstat (e.g., untracked files in the working-tree path) get additions=0, deletions=0 — this is an accepted limitation.

**Note on agent_id column:** The `agent_runs` table gained `agent_id` via `003_agent_management.sql` (Phase 4a migration). The `AgentRunWithStats` query selects it correctly.

**New git helper:**
```go
func DiffNumstat(repoPath, fromRef, toRef string) (map[string][2]int, error)
// Returns map of filepath → [additions, deletions]

func DiffNumstatWorkingTree(repoPath string) (map[string][2]int, error)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+D` | Open run history for active project |

## Backend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/git/git.go` | Modify | Add ShowFile, DiffNumstat, DiffNumstatWorkingTree |
| `internal/git/git_test.go` | Modify | Add tests for new git helpers |
| `internal/agent/manager.go` | Modify | Update trackRun to capture additions/deletions |
| `internal/agent/run.go` | Create | AgentRunWithStats, RunFileChange, FileDiff types + query methods |
| `internal/agent/run_test.go` | Create | Tests for run queries |
| `app.go` | Modify | Add Wails bindings: ListProjectRuns, GetRunFileChanges, GetFileDiff, RevertFile, CommitReviewedChanges |

## Frontend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add AgentRunWithStats, RunFileChange, FileDiff types. Add `runId?: number` to PanelTab. Add `'runHistory' \| 'review'` to PaneType. |
| `frontend/src/stores/reviewStore.ts` | Create | Review state: file decisions, active file, diff mode |
| `frontend/src/components/review/RunHistory.tsx` | Create | Run history list panel |
| `frontend/src/components/review/RunReview.tsx` | Create | Review panel layout (file list + diff viewer) |
| `frontend/src/components/review/FileChangeList.tsx` | Create | File list with accept/reject buttons |
| `frontend/src/components/review/DiffViewer.tsx` | Create | Monaco diff editor wrapper |
| `frontend/src/components/review/CommitModal.tsx` | Create | Commit dialog with message editor |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render review tabs: `tab.type === 'runHistory'` → `<RunHistory projectId={tab.projectId} />`, `tab.type === 'review'` → `<RunReview runId={tab.runId} projectId={tab.projectId} />` |
| `frontend/src/App.tsx` | Modify | Add Ctrl+Shift+D shortcut |
| `frontend/src/stores/overlayStore.ts` | Modify | Add 'commitReview' overlay type |

## Edge Cases

**Run has no end_commit (agent was killed before committing):** The diff viewer can't show frozen diffs. Fall back to showing the current disk state vs base_commit (like Phase 5b's working tree diff). Show a banner: "Agent was stopped before completing. Showing current file state."

**File deleted since run completed:** `git show <end_commit>:<filepath>` still works — it reads from git history, not disk. The diff viewer works fine. Reject/revert also works since `git checkout <base_commit> --` restores from git.

**Binary files:** `git show` will return binary content. Monaco can't diff binaries. Show a placeholder: "Binary file changed" with the file size.

**Very large files:** Monaco handles large files well. Show a warning for files with >1000 lines changed but don't block.

**No file changes in run:** Agent ran but didn't change anything. Show "No file changes in this run" in the review panel.

**Reject then re-accept:** If a file was rejected (reverted on disk), accepting it again should... not be possible without the modified content. Once rejected, the file is reverted. The user would need to re-run the agent or manually undo the revert. The accept button should be disabled for rejected files. Show a note: "File was reverted. Re-run the agent to get these changes back."

## Technical Notes

- Monaco diff editor: `createDiffEditor` creates a heavyweight instance. Dispose when the tab closes. Don't keep hidden diff editors in memory.
- The review panel opens as a tab with `type: 'review'` in the tiling layout. Add 'review' to PaneType.
- `git show <commit>:<path>` works from any working directory within the repo.
- The pre-populated commit message format `[agent-type] task\n\nAgent-Run: <run_id>` uses a blank line before the trailer per git convention.
- `run_file_changes.diff_text` column exists but remains unused — we get diffs live from git. The column is available for Phase 5b or future use.
- All Go backend code gets tests. Git helpers tested with temp repos.
