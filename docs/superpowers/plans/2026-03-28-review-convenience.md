# Review Convenience & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working tree diff view, quick diff access from agent sidebar, and keyboard navigation within diff views.

**Architecture:** Working tree diff reuses Phase 5a's `FileChangeList` and `DiffViewer` components with a `readOnly` mode. Quick diff access adds a "Review" button on done agent cards and smart `Ctrl+Shift+D` routing. Keybindings are implemented as a shared hook used by both review and working tree diff views.

**Tech Stack:** Go 1.25, git CLI, React 18, Zustand, Monaco Editor, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-28-review-convenience-design.md`

**Prerequisite:** Phase 5a must be implemented first (run.go, RunReview, FileChangeList, DiffViewer, review store).

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/agent/run.go` | Modify | Add `GetRunByAgentID` method |
| `internal/agent/run_test.go` | Modify | Add test for `GetRunByAgentID` |
| `app.go` | Modify | Add `GetWorkingTreeChanges`, `GetWorkingTreeFileDiff`, `GetRunByAgentID` bindings |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add `'workingTree'` to PaneType |
| `frontend/src/hooks/useDiffKeybindings.ts` | Create | Shared keybinding hook |
| `frontend/src/components/review/FileChangeList.tsx` | Modify | Add `readOnly` prop |
| `frontend/src/components/review/WorkingTreeDiff.tsx` | Create | Working tree diff layout |
| `frontend/src/components/review/RunReview.tsx` | Modify | Add keybindings via hook |
| `frontend/src/components/sidebar/AgentCard.tsx` | Modify | Add "Review" button for done agents |
| `frontend/src/components/layout/Pane.tsx` | Modify | Render workingTree tabs |
| `frontend/src/App.tsx` | Modify | Add `Ctrl+Shift+G`, smart `Ctrl+Shift+D` |

---

## Task 1: Backend — GetRunByAgentID + Working Tree Bindings

**Files:**
- Modify: `internal/agent/run.go`
- Modify: `internal/agent/run_test.go`
- Modify: `app.go`

- [ ] **Step 1: Write failing test for GetRunByAgentID**

Add to `internal/agent/run_test.go`:

```go
func TestGetRunByAgentID(t *testing.T) {
	store := setupRunTestDB(t)

	store.DB.Exec("INSERT INTO projects (name, path) VALUES ('test', '/tmp/test')")
	store.DB.Exec("INSERT INTO agent_runs (project_id, agent_type, task_description, status, agent_id) VALUES (1, 'claude_code', 'fix bug', 'done', 'agent-abc')")
	store.DB.Exec("INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (1, 'main.go', 'M', 10, 5)")

	svc := NewRunService(store)
	run, err := svc.GetRunByAgentID("agent-abc")
	if err != nil {
		t.Fatalf("GetRunByAgentID failed: %v", err)
	}
	if run.ID != 1 {
		t.Errorf("expected run ID 1, got %d", run.ID)
	}
	if run.FileCount != 1 {
		t.Errorf("expected 1 file, got %d", run.FileCount)
	}
}

func TestGetRunByAgentIDNotFound(t *testing.T) {
	store := setupRunTestDB(t)
	svc := NewRunService(store)

	_, err := svc.GetRunByAgentID("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent agent ID")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/agent/ -v -run TestGetRunByAgentID`
Expected: FAIL — `GetRunByAgentID` undefined

- [ ] **Step 3: Implement GetRunByAgentID**

Add to `internal/agent/run.go`:

```go
func (s *RunService) GetRunByAgentID(agentID string) (*AgentRunWithStats, error) {
	var r AgentRunWithStats
	err := s.store.DB.QueryRow(`
		SELECT
			ar.id, ar.project_id, COALESCE(ar.agent_type,''), COALESCE(ar.task_description,''),
			COALESCE(ar.base_commit,''), COALESCE(ar.end_commit,''), COALESCE(ar.status,''),
			COALESCE(ar.started_at,''), COALESCE(ar.completed_at,''), COALESCE(ar.agent_id,''),
			COUNT(rfc.id) as file_count,
			COALESCE(SUM(rfc.additions), 0) as total_additions,
			COALESCE(SUM(rfc.deletions), 0) as total_deletions
		FROM agent_runs ar
		LEFT JOIN run_file_changes rfc ON rfc.run_id = ar.id
		WHERE ar.agent_id = ?
		GROUP BY ar.id
	`, agentID).Scan(&r.ID, &r.ProjectID, &r.AgentType, &r.TaskDescription,
		&r.BaseCommit, &r.EndCommit, &r.Status,
		&r.StartedAt, &r.CompletedAt, &r.AgentID,
		&r.FileCount, &r.TotalAdditions, &r.TotalDeletions)
	if err != nil {
		return nil, fmt.Errorf("get run by agent ID %s: %w", agentID, err)
	}
	return &r, nil
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/agent/ -v -run TestGetRunByAgentID`
Expected: PASS

- [ ] **Step 5: Add Wails bindings**

Add to `app.go`:

```go
func (a *App) GetRunByAgentID(agentID string) (*agentPkg.AgentRunWithStats, error) {
	return a.runService.GetRunByAgentID(agentID)
}

func (a *App) GetWorkingTreeChanges(projectID int64) ([]agentPkg.RunFileChange, error) {
	project, err := a.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	files, err := gitPkg.DiffWorkingTree(project.Path)
	if err != nil {
		return nil, err
	}
	numstats, _ := gitPkg.DiffNumstatWorkingTree(project.Path)

	var changes []agentPkg.RunFileChange
	for _, f := range files {
		add, del := 0, 0
		if numstats != nil {
			if s, ok := numstats[f.Path]; ok {
				add, del = s[0], s[1]
			}
		}
		changes = append(changes, agentPkg.RunFileChange{
			FilePath:   f.Path,
			ChangeType: f.ChangeType,
			Additions:  add,
			Deletions:  del,
		})
	}
	return changes, nil
}

func (a *App) GetWorkingTreeFileDiff(projectID int64, filePath string) (*agentPkg.FileDiff, error) {
	project, err := a.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	original, _ := gitPkg.ShowFile(project.Path, "HEAD", filePath)
	modified, _ := a.fileTree.ReadFile(filepath.Join(project.Path, filePath))
	return &agentPkg.FileDiff{
		FilePath: filePath,
		Original: original,
		Modified: modified,
	}, nil
}
```

- [ ] **Step 6: Run all Go tests**

Run: `go test ./... -v -timeout 60s`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/agent/run.go internal/agent/run_test.go app.go
git commit -m "feat: GetRunByAgentID, GetWorkingTreeChanges, GetWorkingTreeFileDiff bindings"
```

---

## Task 2: Keybinding Hook + FileChangeList readOnly

**Files:**
- Create: `frontend/src/hooks/useDiffKeybindings.ts`
- Modify: `frontend/src/components/review/FileChangeList.tsx`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add 'workingTree' to PaneType**

In `frontend/src/lib/types.ts`, update PaneType to include `'workingTree'`.

- [ ] **Step 2: Create keybinding hook**

Create `frontend/src/hooks/useDiffKeybindings.ts`:

```typescript
import { useEffect } from 'react';
import { useOverlayStore } from '../stores/overlayStore';

interface DiffKeybindingCallbacks {
  onNextFile?: () => void;
  onPrevFile?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onCommit?: () => void;
  onClose?: () => void;
  onToggleMode?: () => void;
}

export function useDiffKeybindings(
  isActive: boolean,
  callbacks: DiffKeybindingCallbacks
) {
  const overlayActive = useOverlayStore(s => s.active);

  useEffect(() => {
    if (!isActive || overlayActive !== 'none') return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when modifier keys are held (let global shortcuts work)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      switch (e.key) {
        case ']':
          e.preventDefault();
          callbacks.onNextFile?.();
          break;
        case '[':
          e.preventDefault();
          callbacks.onPrevFile?.();
          break;
        case 'a':
          e.preventDefault();
          callbacks.onAccept?.();
          break;
        case 'x':
          e.preventDefault();
          callbacks.onReject?.();
          break;
        case 'c':
          e.preventDefault();
          callbacks.onCommit?.();
          break;
        case 'q':
          e.preventDefault();
          callbacks.onClose?.();
          break;
        case 't':
          e.preventDefault();
          callbacks.onToggleMode?.();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, overlayActive, callbacks]);
}
```

- [ ] **Step 3: Add readOnly prop to FileChangeList**

In `FileChangeList.tsx`, add `readOnly?: boolean` to the props interface. When `readOnly` is true, hide the accept/reject buttons for each file row. The rest of the component (file list, icons, click to select) remains the same.

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/hooks/useDiffKeybindings.ts frontend/src/components/review/FileChangeList.tsx
git commit -m "feat: diff keybinding hook, readOnly mode for file change list"
```

---

## Task 3: Working Tree Diff Component

**Files:**
- Create: `frontend/src/components/review/WorkingTreeDiff.tsx`

- [ ] **Step 1: Create WorkingTreeDiff**

Props: `projectId: number`

On mount: call `window.go.main.App.GetWorkingTreeChanges(projectId)` to load file list.

Layout:
- Top bar: "Working Tree — {project name}" (get project name from projectStore), file count, diff mode toggle button
- Below: flex row — left 30% `FileChangeList` with `readOnly={true}`, right 70% `DiffViewer`

State:
- `files: RunFileChange[]` — loaded on mount
- `activeFilePath: string | null` — which file is selected
- `diffData: FileDiff | null` — loaded when active file changes
- `diffMode: 'side-by-side' | 'inline'`

When `activeFilePath` changes, call `GetWorkingTreeFileDiff(projectId, filePath)` to load diff.

Use `useDiffKeybindings` with:
- `onNextFile` / `onPrevFile` — cycle through file list
- `onToggleMode` — toggle side-by-side/inline
- `onClose` — remove the tab (call `removeTab`)
- No `onAccept`, `onReject`, `onCommit` — these don't apply

Empty state: "No uncommitted changes"

The `isActive` parameter for keybindings: check if `focusedPaneId` matches the pane containing this component. Since the component doesn't know its own pane ID directly, pass it as a prop or check if the tab is visible.

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/review/WorkingTreeDiff.tsx
git commit -m "feat: working tree diff view with read-only file list"
```

---

## Task 4: Add Keybindings to RunReview

**Files:**
- Modify: `frontend/src/components/review/RunReview.tsx`

- [ ] **Step 1: Wire useDiffKeybindings into RunReview**

Import and use `useDiffKeybindings` in `RunReview`:

```typescript
import { useDiffKeybindings } from '../../hooks/useDiffKeybindings';
```

Determine if this pane is focused (check `layoutStore.focusedPaneId` — the review component needs to know its pane ID, which it can get from the tab context or by checking if it's the currently visible content).

Call `useDiffKeybindings(isActive, { ... })` with:
- `onNextFile` — advance to next file in the file list
- `onPrevFile` — go to previous file
- `onAccept` — accept current active file (call `reviewStore.setDecision(activeFile, 'accepted')`)
- `onReject` — reject current active file (call RevertFile, then setDecision)
- `onCommit` — open commit modal (`overlayStore.open('commitReview')`)
- `onClose` — remove the tab
- `onToggleMode` — toggle diff mode

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/review/RunReview.tsx
git commit -m "feat: keyboard shortcuts in run review (]/[ navigate, a/x accept/reject, c commit)"
```

---

## Task 5: Quick Diff Access — Agent Card Review Button

**Files:**
- Modify: `frontend/src/components/sidebar/AgentCard.tsx`

- [ ] **Step 1: Add "Review" button for done agents**

In `AgentCard.tsx`, when `agent.status === 'done'`, show a small "Review" button next to the status label.

On click:
1. Call `window.go.main.App.GetRunByAgentID(agent.id)` to get the run
2. If successful, call `addTab(focusedPaneId, { type: 'review', title: 'Review: ' + agent.taskDescription.slice(0,20), runId: run.id, projectId: agent.projectId })`
3. If error, log it (agent may not have a run record)

The button should be small and subtle — not the primary click action (which still switches to the agent's project/terminal).

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/AgentCard.tsx
git commit -m "feat: Review button on done agent cards in sidebar"
```

---

## Task 6: Wire Into App & Pane + Smart Ctrl+Shift+D

**Files:**
- Modify: `frontend/src/components/layout/Pane.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add workingTree tab rendering to Pane.tsx**

Import `WorkingTreeDiff`:
```typescript
import { WorkingTreeDiff } from '../review/WorkingTreeDiff';
```

Add render branch:
```tsx
tab.type === 'workingTree' ? (
  <WorkingTreeDiff projectId={tab.projectId!} />
) : tab.type === 'runHistory' ? (
  // ... existing
```

- [ ] **Step 2: Add Ctrl+Shift+G and smart Ctrl+Shift+D to App.tsx**

Add `Ctrl+Shift+G` in the switch block:
```typescript
case 'G':
  e.preventDefault();
  if (activeProjectId) {
    addTab(focusedPaneId, {
      type: 'workingTree',
      title: 'Working Tree',
      projectId: activeProjectId,
    });
  }
  break;
```

Update `Ctrl+Shift+D` to be smart — check if there's exactly one done run:
```typescript
case 'D':
  e.preventDefault();
  if (activeProjectId) {
    // Try smart routing: if exactly one done run, open it directly
    (window as any).go.main.App.ListProjectRuns(activeProjectId).then((runs: any[]) => {
      const doneRuns = (runs || []).filter((r: any) => r.status === 'done');
      if (doneRuns.length === 1) {
        addTab(focusedPaneId, {
          type: 'review',
          title: 'Review: ' + (doneRuns[0].taskDescription || '').slice(0, 20),
          runId: doneRuns[0].id,
          projectId: activeProjectId!,
        });
      } else {
        addTab(focusedPaneId, {
          type: 'runHistory',
          title: 'Run History',
          projectId: activeProjectId!,
        });
      }
    }).catch(() => {
      addTab(focusedPaneId, {
        type: 'runHistory',
        title: 'Run History',
        projectId: activeProjectId!,
      });
    });
  }
  break;
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Pane.tsx frontend/src/App.tsx
git commit -m "feat: Ctrl+Shift+G working tree diff, smart Ctrl+Shift+D, wire workingTree tab"
```

---

## Task 7: Wails Bindings & Smoke Test

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
git commit -m "chore: regenerate Wails bindings for review convenience features"
```

---

## Summary

7 tasks:

1. **Backend bindings** — GetRunByAgentID (TDD), GetWorkingTreeChanges, GetWorkingTreeFileDiff
2. **Keybinding hook + readOnly** — shared hook, FileChangeList readOnly prop, types update
3. **WorkingTreeDiff** — new component reusing FileChangeList + DiffViewer
4. **RunReview keybindings** — wire hook into existing review panel
5. **Agent card Review button** — "Review" on done agents
6. **App + Pane wiring** — Ctrl+Shift+G, smart Ctrl+Shift+D, workingTree tab rendering
7. **Bindings + smoke test** — regenerate, full build

**Critical path:** 1 (backend) → 2 → 3 (working tree) + 4 (review keybindings, independent) → 5 → 6 → 7

**Note:** Phase 5a must be implemented first. This plan assumes `run.go`, `RunReview`, `FileChangeList`, `DiffViewer`, and `reviewStore` all exist.
