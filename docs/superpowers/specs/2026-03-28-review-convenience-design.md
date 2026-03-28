# Phase 5b: Review Convenience & Navigation — Design Spec

## Overview

Phase 5a built the core review workflow (run history, diff viewer, accept/reject, commit). Phase 5b adds convenience features: a working tree diff view, quick access to review from the agent sidebar, and keyboard shortcuts for efficient navigation within diffs.

## Features

### 1. Working Tree Diff

A read-only diff view showing uncommitted changes in a project, not tied to any agent run.

**Trigger:** `Ctrl+Shift+G`. Opens as a tab with `type: 'workingTree'`.

**Layout:** Same two-section layout as RunReview — file list (30%) + diff viewer (70%) — but without accept/reject buttons or commit actions. Reuses `FileChangeList` (in view-only mode via a `readOnly` prop that hides action buttons) and `DiffViewer` from Phase 5a.

**Top bar:** "Working Tree — {project name}", file count summary, diff mode toggle (side-by-side/inline).

**Diff source:** Original from `git show HEAD:<filepath>`, modified from current file on disk via `ReadFile`.

**Backend:**

`App.GetWorkingTreeChanges(projectID int64) ([]RunFileChange, error)`:
- Looks up project path
- Calls `git.DiffWorkingTree(projectPath)` (already exists from Phase 4b)
- Also calls `git.DiffNumstatWorkingTree(projectPath)` for line counts
- Returns the combined file list with additions/deletions

`App.GetWorkingTreeFileDiff(projectID int64, filePath string) (*FileDiff, error)`:
- Original: `git.ShowFile(projectPath, "HEAD", filePath)` — empty string if file is new
- Modified: `filetree.ReadFile(filepath.Join(projectPath, filePath))` — empty string if file was deleted
- Returns `FileDiff{FilePath, Original, Modified}`

### 2. Quick Diff Access

**Agent sidebar "Review" button:**
- When an agent's status is `done`, its `AgentCard` shows a small "Review" button
- Clicking calls `App.GetRunByAgentID(agentID)` to get the run ID, then opens a `review` tab

**Backend:**

`App.GetRunByAgentID(agentID string) (*AgentRunWithStats, error)`:
- Queries `agent_runs WHERE agent_id = ?` with aggregated stats
- Returns the run or error if not found

**Smart `Ctrl+Shift+D`:**
- If the active project has exactly one completed run with status `done` (query the run list), open that run's review directly
- Otherwise open the run history list (existing 5a behavior)
- "Completed" means status is `done` — not `error`, not `running`

### 3. Diff Navigation Keybindings

Active when a `review` or `workingTree` tab's pane is focused. Implemented as a `useEffect` keydown listener in `RunReview` and `WorkingTreeDiff` that checks `layoutStore.focusedPaneId` matches the component's pane.

| Key | Action | Applies To |
|-----|--------|-----------|
| `]` | Next file | review, workingTree |
| `[` | Previous file | review, workingTree |
| `a` | Accept current file | review only |
| `x` | Reject current file | review only |
| `c` | Open commit modal | review only |
| `q` | Close the tab | review, workingTree |
| `t` | Toggle side-by-side / inline | review, workingTree |

Keys are only active when no overlay is open (`overlayStore.active === 'none'`) to prevent conflicts with modal inputs.

## Backend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/agent/run.go` | Modify | Add `GetRunByAgentID` method |
| `app.go` | Modify | Add `GetWorkingTreeChanges`, `GetWorkingTreeFileDiff`, `GetRunByAgentID` bindings |

## Frontend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add `'workingTree'` to PaneType |
| `frontend/src/components/review/WorkingTreeDiff.tsx` | Create | Working tree diff layout |
| `frontend/src/components/review/FileChangeList.tsx` | Modify | Add `readOnly` prop to hide action buttons |
| `frontend/src/components/review/RunReview.tsx` | Modify | Add keybinding listener |
| `frontend/src/components/sidebar/AgentCard.tsx` | Modify | Add "Review" button for done agents |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render workingTree tabs |
| `frontend/src/App.tsx` | Modify | Add `Ctrl+Shift+G` shortcut, smart `Ctrl+Shift+D` |
| `frontend/src/hooks/useDiffKeybindings.ts` | Create | Shared keybinding hook for review/workingTree |

## Edge Cases

**Working tree has no changes:** Show "No uncommitted changes" empty state.

**File is binary:** Same handling as Phase 5a — show "Binary file changed" placeholder.

**Agent has no run record:** `GetRunByAgentID` returns error, "Review" button shows toast "No run data available".

**Pane loses focus while keybinding active:** The keydown listener checks `focusedPaneId` on each keypress, so keys only fire when the review pane is focused.

**Ctrl+Shift+D with no completed runs:** Opens empty run history (existing 5a behavior).

## Technical Notes

- `WorkingTreeDiff` shares `FileChangeList` and `DiffViewer` from Phase 5a. The `readOnly` prop on `FileChangeList` simply hides the accept/reject buttons — no structural change.
- The keybinding hook (`useDiffKeybindings`) is shared between `RunReview` and `WorkingTreeDiff`. It receives callbacks for each action and only binds the ones that are provided (e.g., `WorkingTreeDiff` doesn't pass `onAccept`/`onReject`/`onCommit`).
- `GetWorkingTreeChanges` reuses existing `git.DiffWorkingTree` and `git.DiffNumstatWorkingTree` — no new git helpers needed.
- `GetWorkingTreeFileDiff` reads the current file from disk (not from git), which is different from the run review's frozen-at-commit approach.
