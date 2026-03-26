# Phase 4b: Agent Management Polish — Design Spec

## Overview

Phase 4a made Quarterdeck agent-aware with spawn, state detection, and sidebar status. Phase 4b adds the polish layer: desktop notifications so you know when agents need attention even from another workspace, git-based run tracking to capture what agents changed, status bar integration for at-a-glance agent health, and upgraded sidebar indicators that reflect agent state.

## Features

### 1. Desktop Notifications

Fire `notify-send` when an agent transitions to a state that needs user attention.

**Implementation:** `internal/agent/notify.go`

```go
func Notify(title, body, urgency string) {
    cmd := exec.Command("notify-send",
        "--urgency", urgency,
        "--app-name", "Quarterdeck",
        title, body,
    )
    cmd.Start() // fire-and-forget, don't wait
}
```

**Trigger points** (in `manager.go`'s `onStatusChange`):

| Status | Title | Body | Urgency |
|--------|-------|------|---------|
| `needs_input` | `[project] Agent needs input` | agent display name | `normal` |
| `done` | `[project] Agent finished` | agent display name | `low` |
| `error` | `[project] Agent errored` | `exit code N` | `critical` |

No notification for `starting` or `working` — these are expected transitions.

Always on — no settings toggle. The existing `notification_on_agent_complete` and `notification_on_agent_error` settings from Phase 1 schema are legacy and ignored for now — they can be wired up in a future settings UI. The project name is looked up from the agent's `projectId` via the project service.

### 2. Agent Run Tracking

On agent completion, capture what the agent changed via git.

**Trigger:** `onStatusChange` when status transitions to `done` or `error`.

**Sequence:**
1. Read `agent.BaseCommit` (stored on the Agent struct at spawn time)
2. If `base_commit` is empty (not a git repo): skip all tracking, just update `completed_at`
3. Call `git.HeadCommit(workDir)` to get `end_commit`
4. If `base_commit` differs from `end_commit`:
   - Call `git.DiffFileList(workDir, base_commit, end_commit)` for committed changes
5. If `base_commit` equals `end_commit` (no new commits):
   - Call `git.DiffWorkingTree(workDir)` for uncommitted changes (staged + unstaged)
6. Update `agent_runs` row: set `end_commit`, `completed_at`
7. Insert each changed file into `run_file_changes`: `run_id`, `file_path`, `change_type` (A/M/D)
8. No `diff_text` stored — file list and change types only
9. Log git failures at `log.Printf` level (matching existing patterns in manager.go), but don't fail the status transition

**New package:** `internal/git/git.go`

```go
type FileChange struct {
    Path       string
    ChangeType string // "A" (added), "M" (modified), "D" (deleted)
}

func HeadCommit(repoPath string) (string, error)
func DiffFileList(repoPath, fromRef, toRef string) ([]FileChange, error)
func DiffWorkingTree(repoPath string) ([]FileChange, error)
```

All functions shell out to `git` CLI:
- `HeadCommit`: `git rev-parse HEAD`
- `DiffFileList`: `git diff --name-status <from> <to>` — parses `A/M/D` lines. Renames (`R`) are normalized to `A` (new path stored). Copy (`C`) normalized to `A`.
- `DiffWorkingTree`: `git status --porcelain` — captures both staged and unstaged changes. Parses the two-character status codes to A/M/D.

**Manager integration:** The agent manager needs the project path to run git commands. It already has `projectID` on the agent — it looks up the project path from the DB via the project service (or stores `workDir` on the Agent struct at spawn time).

Add `WorkDir string` and `BaseCommit string` to the `Agent` struct (both available at spawn time — `workDir` from the parameter, `baseCommit` from the git HEAD capture).

### 3. Status Bar Agent Integration

**Modify:** `frontend/src/components/layout/StatusBar.tsx`

Add an agent status section to the right side of the status bar (before the terminal count):

- Read from `agentStore.agents` — filter inline for active count and attention breakdown
- Display format: `"N agents"` or `"N agents (M needs input)"`
- Color priority: red (`#f87171`) if any agent has `error` status, yellow (`#facc15`) if any has `needs_input`, default `var(--text-secondary)` otherwise. Check error first since it's more severe.
- Only shown when there are active agents (hide when count is 0)

### 4. Sidebar Activity Indicator Upgrade

**Modify:** `frontend/src/components/sidebar/ProjectEntry.tsx`

Replace the Phase 3 terminal-based activity dots with agent-aware indicators:

**Priority order (first match wins):**
1. Any agent `error` → red dot
2. Any agent `needs_input` → yellow dot
3. All agents `done` → green checkmark (or green dot with checkmark)
4. Any agent `working`/`starting` → green dot (pulsing implied by "working" state)
5. No agents → fall back to Phase 3 behavior:
   - Background terminal has new output → yellow dot
   - All background terminals exited → gray dot
   - No background terminals → no dot

The agent check uses `agentStore.getProjectAgents(project.id)`. This wraps the existing activity dot logic — the agent priority check runs first, and only if there are no agents does it fall back to the existing Phase 3 `hasNewOutput`/`allExited` background terminal logic. The existing `isActive` guard (no dot for the active project) remains in place. The Phase 3 yellow dot brightness decay (bright if < 30s, dimmer if older) is preserved in the fallback path.

## Backend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/agent/notify.go` | Create | `Notify(title, body, urgency)` via notify-send |
| `internal/agent/manager.go` | Modify | Call Notify on status change, capture git diff on completion |
| `internal/agent/agent.go` | Modify | Add `WorkDir string` and `BaseCommit string` to Agent struct |
| `internal/git/git.go` | Create | HeadCommit, DiffFileList, DiffWorkingTree helpers |
| `internal/git/git_test.go` | Create | Tests with temp git repos |

## Frontend File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/layout/StatusBar.tsx` | Modify | Add agent count display |
| `frontend/src/components/sidebar/ProjectEntry.tsx` | Modify | Agent-aware activity dots |

## Edge Cases

**notify-send not installed:** `cmd.Start()` will fail silently. The in-app indicators still work. No crash, no error log needed.

**Agent completed but git repo is gone:** `HeadCommit` returns error, tracking is skipped. Agent status still updates correctly.

**Multiple agents on same project finish simultaneously:** Each `onStatusChange` runs independently. Git operations are stateless (just reading HEAD and diffing), so concurrent calls are safe.

**Agent `WorkDir` is a subdirectory of the project:** Git operations still work — `git rev-parse HEAD` and `git diff` work from any subdirectory within a repo.

## Technical Notes

- All Go backend code gets tests. Git helpers use temp directories with real git repos.
- `notify-send` is fire-and-forget via `cmd.Start()` (not `cmd.Run()`). We don't check the error.
- The `WorkDir` field on Agent is set at spawn time and never changes. It's serialized in JSON for the frontend but the frontend doesn't need it.
- `run_file_changes` rows are created but never queried in Phase 4b — they're stored for Phase 5 (diff review UI). The schema already exists from Phase 1.
