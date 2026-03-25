# Multi-Project Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Quarterdeck to manage multiple projects simultaneously with per-project layout memory, background terminal persistence, and fast project switching.

**Architecture:** Project-as-workspace model — one project's layout rendered at a time, layout serialized on switch-away and restored on switch-to. WebSocket connections for background terminals stay open with output buffered in a ring buffer. Separate `backgroundTerminalStore` manages detached terminal lifecycle.

**Tech Stack:** Go 1.25, Wails v2, SQLite (modernc.org/sqlite), React 18, Zustand, Monaco Editor, xterm.js, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-multi-project-workspace-design.md`

---

## File Structure

### Backend (Go)

| File | Action | Responsibility |
|------|--------|---------------|
| `internal/db/migrations/002_multi_project.sql` | Create | Schema migration: add columns to projects and layouts tables |
| `internal/project/service.go` | Modify | Add `Update()` method, update `List()` ordering, add new fields to `Project` struct and queries |
| `internal/project/service_test.go` | Modify | Add tests for `Update()`, sort ordering |
| `internal/layout/service.go` | Create | Layout persistence: `SaveLayout()`, `GetLayout()`, `DeleteLayout()` |
| `internal/layout/service_test.go` | Create | Tests for layout persistence |
| `internal/filetree/service.go` | Modify | Add `ListFiles()` for file search |
| `internal/filetree/service_test.go` | Create | Tests for `ListFiles()` |
| `app.go` | Modify | Add new Wails bindings: `UpdateProject`, `SaveLayout`, `GetLayout`, `ListProjectFiles`, update `CreateTerminal` signature |

### Frontend (TypeScript/React)

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/types.ts` | Modify | Add new types: `ProjectLayout`, `EditorTabSnapshot`, `TerminalPositionSnapshot`, `UpdateFields`, extend `Project` |
| `frontend/src/lib/ringBuffer.ts` | Create | Generic ring buffer data structure |
| `frontend/src/lib/fuzzyMatch.ts` | Create | Fuzzy string matching with scoring |
| `frontend/src/lib/projectColors.ts` | Create | Color palette constant and resolver |
| `frontend/src/stores/projectStore.ts` | Modify | Add layout snapshots, branch caching, `switchProject()`, `updateProject()`, `isSwitching` guard |
| `frontend/src/stores/backgroundTerminalStore.ts` | Create | Detached WS management, ring buffer, activity tracking |
| `frontend/src/stores/terminalStore.ts` | Modify | Add `projectId` per session, bulk clear |
| `frontend/src/stores/editorStore.ts` | Modify | Add `replaceAll()` for layout restore, snapshot helpers |
| `frontend/src/stores/layoutStore.ts` | Modify | Add `setRoot()`, `syncNextId()`, export tree traversal helpers |
| `frontend/src/stores/overlayStore.ts` | Create | Which overlay is open (none, projectSwitcher, fileSearch, addProject) |
| `frontend/src/components/sidebar/Sidebar.tsx` | Modify | Rich project entries, context menu, drag reorder, activity dots |
| `frontend/src/components/sidebar/ProjectEntry.tsx` | Create | Single project row with color border, branch, indicators |
| `frontend/src/components/sidebar/AddProjectModal.tsx` | Create | Add project dialog |
| `frontend/src/components/sidebar/ContextMenu.tsx` | Create | Right-click context menu |
| `frontend/src/components/overlay/ProjectSwitcher.tsx` | Create | Ctrl+Shift+P overlay |
| `frontend/src/components/overlay/FileSearch.tsx` | Create | Ctrl+P overlay |
| `frontend/src/components/overlay/OverlayContainer.tsx` | Create | Shared overlay backdrop + dismiss logic |
| `frontend/src/components/terminal/Terminal.tsx` | Modify | Accept optional sessionId for reattach, show exit state |
| `frontend/src/components/terminal/TerminalExited.tsx` | Create | "[session ended — exit N]" with Restart button |
| `frontend/src/components/settings/ProjectSettings.tsx` | Create | Project settings tab panel |
| `frontend/src/components/layout/Pane.tsx` | Modify | Pass projectId to terminal creation |
| `frontend/src/components/layout/StatusBar.tsx` | Modify | Show project color tint |
| `frontend/src/hooks/useTerminal.ts` | Modify | Support reattach mode (existing WS + buffer), detach API |
| `frontend/src/App.tsx` | Modify | New keyboard shortcuts, render overlay container |

---

## Task 1: SQLite Migration & Project Service Updates

**Files:**
- Create: `internal/db/migrations/002_multi_project.sql`
- Modify: `internal/project/service.go`
- Modify: `internal/project/service_test.go`

- [ ] **Step 1a: Update migration runner to track applied migrations**

The current `db.go:migrate()` runs all `.sql` files on every startup. `ALTER TABLE ADD COLUMN` will crash on second run. Fix by adding a migration tracking table.

In `internal/db/db.go`, replace the `migrate()` method:

```go
func (s *Store) migrate() error {
	// Create migration tracking table
	_, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		filename TEXT PRIMARY KEY,
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		// Check if already applied
		var count int
		s.DB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE filename = ?", entry.Name()).Scan(&count)
		if count > 0 {
			continue
		}

		data, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		if _, err := s.DB.Exec(string(data)); err != nil {
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
		}

		// Mark as applied
		s.DB.Exec("INSERT INTO schema_migrations (filename) VALUES (?)", entry.Name())
	}

	return nil
}
```

Add a test in `internal/db/db_test.go` to verify migrations are idempotent:
```go
func TestMigrateIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store1, err := Open(dbPath)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	store1.Close()

	// Second open should not error
	store2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("second open should be idempotent: %v", err)
	}
	store2.Close()
}
```

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/db/ -v -run TestMigrateIdempotent`
Expected: PASS

- [ ] **Step 1b: Write the migration file**

Create `internal/db/migrations/002_multi_project.sql`:

```sql
-- Add project_id to layouts for per-project layout storage
ALTER TABLE layouts ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_layouts_project ON layouts(project_id) WHERE project_id IS NOT NULL;

-- Add ordering and appearance columns to projects
ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN color TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;
```

**Important:** The migration runner (`db.go`) executes ALL migration files on every startup. `001_init.sql` is idempotent via `CREATE TABLE IF NOT EXISTS`. But `ALTER TABLE ADD COLUMN` is NOT idempotent in SQLite — it will error on re-run. We must update the migration runner to track which migrations have run. See Step 1a below.

- [ ] **Step 2: Write failing test for Update method**

Add to `internal/project/service_test.go`:

```go
func TestUpdateProject(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	p, _ := svc.Add("original", "/tmp/original")

	err := svc.Update(p.ID, UpdateFields{Name: strPtr("renamed")})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	got, _ := svc.Get(p.ID)
	if got.Name != "renamed" {
		t.Errorf("expected 'renamed', got %q", got.Name)
	}
}

func TestUpdateProjectSortOrder(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	svc.Add("beta", "/tmp/beta")
	svc.Add("alpha", "/tmp/alpha")

	// Update sort_order so beta comes first
	projects, _ := svc.List()
	// Default ordering is by sort_order, name — both have sort_order 0, so alpha first
	if projects[0].Name != "alpha" {
		t.Fatalf("expected alpha first by default, got %q", projects[0].Name)
	}

	// Set beta to sort_order -1 so it comes first
	beta, _ := svc.Get(projects[1].ID)
	svc.Update(beta.ID, UpdateFields{SortOrder: intPtr(-1)})

	projects, _ = svc.List()
	if projects[0].Name != "beta" {
		t.Errorf("expected beta first after reorder, got %q", projects[0].Name)
	}
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/project/ -v -run "TestUpdate"`
Expected: FAIL — `UpdateFields` and `Update` undefined

- [ ] **Step 4: Add new fields to Project struct and implement Update**

In `internal/project/service.go`, add to the `Project` struct:

```go
type Project struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Path             string `json:"path"`
	GitDefaultBranch string `json:"gitDefaultBranch"`
	DevServerURL     string `json:"devServerUrl"`
	DevServerCommand string `json:"devServerCommand"`
	DefaultAgentType string `json:"defaultAgentType"`
	SortOrder        int    `json:"sortOrder"`
	Color            string `json:"color"`
	Notes            string `json:"notes"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type UpdateFields struct {
	Name             *string `json:"name,omitempty"`
	GitDefaultBranch *string `json:"gitDefaultBranch,omitempty"`
	DevServerURL     *string `json:"devServerUrl,omitempty"`
	DevServerCommand *string `json:"devServerCommand,omitempty"`
	DefaultAgentType *string `json:"defaultAgentType,omitempty"`
	SortOrder        *int    `json:"sortOrder,omitempty"`
	Color            *string `json:"color,omitempty"`
	Notes            *string `json:"notes,omitempty"`
}
```

Add the `Update` method:

```go
func (s *Service) Update(id int64, fields UpdateFields) error {
	var setClauses []string
	var args []interface{}

	if fields.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *fields.Name)
	}
	if fields.GitDefaultBranch != nil {
		setClauses = append(setClauses, "git_default_branch = ?")
		args = append(args, *fields.GitDefaultBranch)
	}
	if fields.DevServerURL != nil {
		setClauses = append(setClauses, "dev_server_url = ?")
		args = append(args, *fields.DevServerURL)
	}
	if fields.DevServerCommand != nil {
		setClauses = append(setClauses, "dev_server_command = ?")
		args = append(args, *fields.DevServerCommand)
	}
	if fields.DefaultAgentType != nil {
		setClauses = append(setClauses, "default_agent_type = ?")
		args = append(args, *fields.DefaultAgentType)
	}
	if fields.SortOrder != nil {
		setClauses = append(setClauses, "sort_order = ?")
		args = append(args, *fields.SortOrder)
	}
	if fields.Color != nil {
		setClauses = append(setClauses, "color = ?")
		args = append(args, *fields.Color)
	}
	if fields.Notes != nil {
		setClauses = append(setClauses, "notes = ?")
		args = append(args, *fields.Notes)
	}

	if len(setClauses) == 0 {
		return nil
	}

	setClauses = append(setClauses, "updated_at = ?")
	args = append(args, time.Now().UTC().Format(time.RFC3339))
	args = append(args, id)

	query := fmt.Sprintf("UPDATE projects SET %s WHERE id = ?", strings.Join(setClauses, ", "))
	_, err := s.store.DB.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("update project %d: %w", id, err)
	}
	return nil
}
```

Add `"strings"` to the imports.

Update `List()` query to change `ORDER BY name` to `ORDER BY sort_order, name`.

Update `List()` and `Get()` scan to include new fields: add `COALESCE(sort_order, 0), COALESCE(color,''), COALESCE(notes,'')` to SELECT and `&p.SortOrder, &p.Color, &p.Notes` to Scan.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/project/ -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add internal/db/db.go internal/db/db_test.go internal/db/migrations/002_multi_project.sql internal/project/service.go internal/project/service_test.go
git commit -m "feat: idempotent migration runner, project Update method, sort_order/color/notes columns"
```

---

## Task 2: Layout Persistence Service

**Files:**
- Create: `internal/layout/service.go`
- Create: `internal/layout/service_test.go`
- Modify: `app.go`

- [ ] **Step 1: Write failing tests for layout service**

Create `internal/layout/service_test.go`:

```go
package layout

import (
	"path/filepath"
	"testing"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

func setupTestDB(t *testing.T) *db.Store {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestSaveAndGetLayout(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	json := `{"projectId":1,"tilingTree":{"type":"leaf","id":"pane-1"}}`
	err := svc.Save(1, json)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := svc.Get(1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got != json {
		t.Errorf("expected %q, got %q", json, got)
	}
}

func TestSaveOverwritesExisting(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	svc.Save(1, `{"v":1}`)
	svc.Save(1, `{"v":2}`)

	got, _ := svc.Get(1)
	if got != `{"v":2}` {
		t.Errorf("expected v2, got %q", got)
	}
}

func TestGetNonexistentLayout(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	got, err := svc.Get(999)
	if err != nil {
		t.Fatalf("Get should not error for missing layout: %v", err)
	}
	if got != "" {
		t.Errorf("expected empty string for missing layout, got %q", got)
	}
}

func TestDeleteLayout(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	svc.Save(1, `{"data":"test"}`)
	err := svc.Delete(1)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	got, _ := svc.Get(1)
	if got != "" {
		t.Errorf("expected empty after delete, got %q", got)
	}
}

func TestGetAllLayouts(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	svc.Save(1, `{"p":1}`)
	svc.Save(2, `{"p":2}`)

	all, err := svc.GetAll()
	if err != nil {
		t.Fatalf("GetAll failed: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("expected 2 layouts, got %d", len(all))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/layout/ -v`
Expected: FAIL — package doesn't exist

- [ ] **Step 3: Implement layout service**

Create `internal/layout/service.go`:

```go
package layout

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

type Service struct {
	store *db.Store
}

func NewService(store *db.Store) *Service {
	return &Service{store: store}
}

// Save upserts a layout JSON for a project.
func (s *Service) Save(projectID int64, layoutJSON string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.store.DB.Exec(`
		INSERT INTO layouts (project_id, layout_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(project_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at
	`, projectID, layoutJSON, now)
	if err != nil {
		return fmt.Errorf("save layout for project %d: %w", projectID, err)
	}
	return nil
}

// Get returns the layout JSON for a project, or empty string if not found.
func (s *Service) Get(projectID int64) (string, error) {
	var json string
	err := s.store.DB.QueryRow(
		"SELECT layout_json FROM layouts WHERE project_id = ?", projectID,
	).Scan(&json)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get layout for project %d: %w", projectID, err)
	}
	return json, nil
}

// GetAll returns all saved project layouts as a map of projectID → JSON.
func (s *Service) GetAll() (map[int64]string, error) {
	rows, err := s.store.DB.Query(
		"SELECT project_id, layout_json FROM layouts WHERE project_id IS NOT NULL",
	)
	if err != nil {
		return nil, fmt.Errorf("query layouts: %w", err)
	}
	defer rows.Close()

	result := make(map[int64]string)
	for rows.Next() {
		var id int64
		var json string
		if err := rows.Scan(&id, &json); err != nil {
			return nil, fmt.Errorf("scan layout: %w", err)
		}
		result[id] = json
	}
	return result, rows.Err()
}

// Delete removes the layout for a project.
func (s *Service) Delete(projectID int64) error {
	_, err := s.store.DB.Exec("DELETE FROM layouts WHERE project_id = ?", projectID)
	if err != nil {
		return fmt.Errorf("delete layout for project %d: %w", projectID, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/layout/ -v`
Expected: ALL PASS

- [ ] **Step 5: Add Wails bindings in app.go**

Add to `app.go`:

```go
import (
	// ... existing imports
	"github.com/kkjorsvik/quarterdeck/internal/layout"
)
```

Add field to `App` struct:
```go
layouts *layout.Service
```

In `startup()`, after `a.projects = ...`:
```go
a.layouts = layout.NewService(store)
```

Add bound methods:
```go
func (a *App) UpdateProject(id int64, fields project.UpdateFields) error {
	return a.projects.Update(id, fields)
}

func (a *App) SaveLayout(projectID int64, layoutJSON string) error {
	return a.layouts.Save(projectID, layoutJSON)
}

func (a *App) GetLayout(projectID int64) (string, error) {
	return a.layouts.Get(projectID)
}

func (a *App) GetAllLayouts() (map[int64]string, error) {
	return a.layouts.GetAll()
}
```

Update `CreateTerminal` to accept `projectId`:
```go
func (a *App) CreateTerminal(workDir string, cols, rows int) (string, error) {
```
Keep the existing signature as-is for now — the frontend will pass the project path directly. The spec's `CreateTerminal(projectId int64, ...)` approach requires a lookup, but the current pattern of passing `workDir` is simpler and already works. We'll use `workDir` (the project's path) from the frontend.

- [ ] **Step 6: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add internal/layout/ app.go
git commit -m "feat: layout persistence service and Wails bindings for UpdateProject, SaveLayout"
```

---

## Task 3: Frontend Utilities (Ring Buffer, Fuzzy Match, Colors)

**Files:**
- Create: `frontend/src/lib/ringBuffer.ts`
- Create: `frontend/src/lib/fuzzyMatch.ts`
- Create: `frontend/src/lib/projectColors.ts`

- [ ] **Step 1: Create ring buffer**

Create `frontend/src/lib/ringBuffer.ts`:

```typescript
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  drain(): T[] {
    const items: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      items.push(this.buffer[idx] as T);
    }
    this.count = 0;
    this.head = 0;
    return items;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }
}
```

- [ ] **Step 2: Create fuzzy match utility**

Create `frontend/src/lib/fuzzyMatch.ts`:

```typescript
export interface FuzzyResult {
  score: number;
  matches: number[];  // indices of matched characters in the target
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matches: number[] = [];
  let score = 0;
  let qi = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);

      // Adjacency bonus: consecutive matches score higher
      if (lastMatchIdx === ti - 1) {
        score += 3;
      } else {
        score += 1;
      }

      // Start-of-word bonus
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '-' || t[ti - 1] === '_' || t[ti - 1] === '.') {
        score += 2;
      }

      lastMatchIdx = ti;
      qi++;
    }
  }

  // All query characters must match
  if (qi < q.length) return null;

  // Shorter targets with same match score are preferred
  score -= target.length * 0.1;

  return { score, matches };
}
```

- [ ] **Step 3: Create project colors**

Create `frontend/src/lib/projectColors.ts`:

```typescript
export const PROJECT_COLORS = [
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#34d399', // green
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#facc15', // yellow
  '#f87171', // red
  '#2dd4bf', // teal
  '#a3e635', // lime
];

export function getProjectColor(sortOrder: number, dbColor: string | null): string {
  if (dbColor) return dbColor;
  return PROJECT_COLORS[((sortOrder % PROJECT_COLORS.length) + PROJECT_COLORS.length) % PROJECT_COLORS.length];
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/lib/ringBuffer.ts frontend/src/lib/fuzzyMatch.ts frontend/src/lib/projectColors.ts
git commit -m "feat: ring buffer, fuzzy match, and project color utilities"
```

---

## Task 4: Update Frontend Types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add new types to types.ts**

Append to `frontend/src/lib/types.ts`:

```typescript
// Multi-project types

export interface UpdateFields {
  name?: string;
  gitDefaultBranch?: string;
  devServerUrl?: string;
  devServerCommand?: string;
  defaultAgentType?: string;
  sortOrder?: number;
  color?: string;
  notes?: string;
}

export interface ProjectLayout {
  projectId: number;
  tilingTree: LayoutNode;
  editorTabs: EditorTabSnapshot[];
  activeEditorTab: string | null;
  terminalPositions: TerminalPositionSnapshot[];
}

export interface EditorTabSnapshot {
  paneId: string;
  filePath: string;
  cursorPosition: { line: number; column: number };
  scrollPosition: number;
  dirtyContent: string | null;
}

export interface TerminalPositionSnapshot {
  sessionId: string;
  paneId: string;
  tabIndex: number;
}
```

Add new fields to the existing `Project` interface:

```typescript
export interface Project {
  id: number;
  name: string;
  path: string;
  gitDefaultBranch: string;
  devServerUrl: string;
  devServerCommand: string;
  defaultAgentType: string;
  sortOrder: number;
  color: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/lib/types.ts
git commit -m "feat: add multi-project TypeScript types"
```

---

## Task 5: Overlay Store & Background Terminal Store

**Files:**
- Create: `frontend/src/stores/overlayStore.ts`
- Create: `frontend/src/stores/backgroundTerminalStore.ts`

- [ ] **Step 1: Create overlay store**

Create `frontend/src/stores/overlayStore.ts`:

```typescript
import { create } from 'zustand';

type OverlayType = 'none' | 'addProject' | 'projectSwitcher' | 'fileSearch';

interface OverlayState {
  active: OverlayType;
  open: (type: OverlayType) => void;
  close: () => void;
  toggle: (type: OverlayType) => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  active: 'none',

  open: (type) => set({ active: type }),

  close: () => set({ active: 'none' }),

  toggle: (type) => {
    const current = get().active;
    set({ active: current === type ? 'none' : type });
  },
}));
```

- [ ] **Step 2: Create background terminal store**

Create `frontend/src/stores/backgroundTerminalStore.ts`:

```typescript
import { create } from 'zustand';
import { RingBuffer } from '../lib/ringBuffer';

export interface BackgroundTerminal {
  sessionId: string;
  projectId: number;
  wsConnection: WebSocket;
  outputBuffer: RingBuffer<Uint8Array>;
  hasNewOutput: boolean;
  lastOutputTimestamp: number;
  exitInfo: { code: number; command: string } | null;
}

interface BackgroundTerminalState {
  terminals: Map<string, BackgroundTerminal>;

  detach: (sessionId: string, projectId: number, ws: WebSocket, command: string) => void;
  reattach: (sessionId: string) => { ws: WebSocket; buffer: Uint8Array[] } | null;

  getByProject: (projectId: number) => BackgroundTerminal[];
  hasNewOutput: (projectId: number) => boolean;
  getProjectOutputTimestamp: (projectId: number) => number | null;
  clearNewOutput: (projectId: number) => void;

  removeSession: (sessionId: string) => void;
  removeByProject: (projectId: number) => void;
}

export const useBackgroundTerminalStore = create<BackgroundTerminalState>((set, get) => ({
  terminals: new Map(),

  detach: (sessionId, projectId, ws, command) => set((state) => {
    const terminals = new Map(state.terminals);
    const bg: BackgroundTerminal = {
      sessionId,
      projectId,
      wsConnection: ws,
      outputBuffer: new RingBuffer<Uint8Array>(5000),
      hasNewOutput: false,
      lastOutputTimestamp: 0,
      exitInfo: null,
    };

    // Swap WS onmessage to buffer mode
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        bg.outputBuffer.push(new Uint8Array(event.data));
        bg.hasNewOutput = true;
        bg.lastOutputTimestamp = Date.now();
        // Trigger reactivity
        set((s) => ({ terminals: new Map(s.terminals) }));
      } else if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'exited') {
            bg.exitInfo = { code: msg.exitCode, command };
            bg.hasNewOutput = true;
            bg.lastOutputTimestamp = Date.now();
            set((s) => ({ terminals: new Map(s.terminals) }));
          }
        } catch { /* ignore */ }
      }
    };

    ws.onclose = () => {
      if (!bg.exitInfo) {
        bg.exitInfo = { code: -1, command };
      }
      set((s) => ({ terminals: new Map(s.terminals) }));
    };

    terminals.set(sessionId, bg);
    return { terminals };
  }),

  reattach: (sessionId) => {
    const state = get();
    const bg = state.terminals.get(sessionId);
    if (!bg) return null;

    const buffer = bg.outputBuffer.drain();
    const ws = bg.wsConnection;

    // Remove from background store
    const terminals = new Map(state.terminals);
    terminals.delete(sessionId);
    set({ terminals });

    return { ws, buffer };
  },

  getByProject: (projectId) => {
    return Array.from(get().terminals.values()).filter(t => t.projectId === projectId);
  },

  hasNewOutput: (projectId) => {
    return Array.from(get().terminals.values()).some(
      t => t.projectId === projectId && t.hasNewOutput
    );
  },

  getProjectOutputTimestamp: (projectId) => {
    const terminals = Array.from(get().terminals.values()).filter(t => t.projectId === projectId);
    if (terminals.length === 0) return null;
    return Math.max(...terminals.map(t => t.lastOutputTimestamp));
  },

  clearNewOutput: (projectId) => set((state) => {
    const terminals = new Map(state.terminals);
    for (const [id, bg] of terminals) {
      if (bg.projectId === projectId) {
        terminals.set(id, { ...bg, hasNewOutput: false });
      }
    }
    return { terminals };
  }),

  removeSession: (sessionId) => set((state) => {
    const terminals = new Map(state.terminals);
    const bg = terminals.get(sessionId);
    if (bg) {
      bg.wsConnection.close();
      terminals.delete(sessionId);
    }
    return { terminals };
  }),

  removeByProject: (projectId) => set((state) => {
    const terminals = new Map(state.terminals);
    for (const [id, bg] of terminals) {
      if (bg.projectId === projectId) {
        bg.wsConnection.close();
        terminals.delete(id);
      }
    }
    return { terminals };
  }),
}));
```

- [ ] **Step 3: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/stores/overlayStore.ts frontend/src/stores/backgroundTerminalStore.ts
git commit -m "feat: overlay store and background terminal store"
```

---

## Task 6: Update Layout Store for Save/Restore

**Files:**
- Modify: `frontend/src/stores/layoutStore.ts`

- [ ] **Step 1: Add setRoot and syncNextId to layout store**

Add to `layoutStore.ts` — a `setRoot()` action that replaces the tree and syncs the ID counter, plus export the tree traversal helpers:

At the top of the file, add a helper to find the max numeric ID in a tree:
```typescript
function maxIdInTree(node: LayoutNode): number {
  const numId = (id: string) => {
    const match = id.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  if (node.type === 'leaf') {
    let max = numId(node.id);
    for (const tab of node.tabs) {
      max = Math.max(max, numId(tab.id));
    }
    return max;
  }

  return Math.max(
    numId(node.id),
    maxIdInTree(node.children[0]),
    maxIdInTree(node.children[1])
  );
}
```

Add to the store interface:
```typescript
setRoot: (root: LayoutNode) => void;
```

Add to the store implementation:
```typescript
setRoot: (root) => set(() => {
  // Sync nextId to avoid collisions with restored IDs
  nextId = maxIdInTree(root) + 1;
  return { root, focusedPaneId: findFirstLeaf(root) };
}),
```

- [ ] **Step 2: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/stores/layoutStore.ts
git commit -m "feat: add setRoot to layout store with ID counter sync"
```

---

## Task 7: Update Editor Store for Save/Restore

**Files:**
- Modify: `frontend/src/stores/editorStore.ts`

- [ ] **Step 1: Add replaceAll and snapshot methods**

Add to the `EditorState` interface:
```typescript
replaceAll: (files: OpenFile[], activeIndex: number) => void;
```

Add to the store implementation:
```typescript
replaceAll: (files, activeIndex) => set({
  openFiles: files,
  activeFileIndex: activeIndex,
}),
```

- [ ] **Step 2: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/stores/editorStore.ts
git commit -m "feat: add replaceAll to editor store for layout restore"
```

---

## Task 8: Update Terminal Store with Project Tracking

**Files:**
- Modify: `frontend/src/stores/terminalStore.ts`

- [ ] **Step 1: Add projectId to terminal sessions**

Update the `TerminalSession` interface:
```typescript
interface TerminalSession {
  id: string;
  paneId: string;
  projectId: number;
  command: string;
}
```

Update `addSession` signature to accept `projectId` and `command`:
```typescript
addSession: (paneId: string, sessionId: string, projectId: number, command: string) => void;
```

Update the implementation:
```typescript
addSession: (paneId, sessionId, projectId, command) => set((state) => {
  const sessions = new Map(state.sessions);
  sessions.set(paneId, { id: sessionId, paneId, projectId, command });
  return { sessions, activeSessionId: sessionId };
}),
```

Add methods to get sessions by project, clear by project, and register/get WebSocket refs (needed for detach during project switch):
```typescript
getSessionsByProject: (projectId: number) => TerminalSession[];
clearByProject: (projectId: number) => void;
registerWs: (paneId: string, ws: WebSocket) => void;
getWs: (paneId: string) => WebSocket | undefined;
```

Add a `wsRefs` map to track WebSocket connections per pane:
```typescript
// Outside the store (not reactive — just a ref map)
const wsRefs = new Map<string, WebSocket>();
```

Implement:
```typescript
getSessionsByProject: (projectId) => {
  return Array.from(get().sessions.values()).filter(s => s.projectId === projectId);
},

clearByProject: (projectId) => set((state) => {
  const sessions = new Map(state.sessions);
  for (const [paneId, session] of sessions) {
    if (session.projectId === projectId) {
      wsRefs.delete(paneId);
      sessions.delete(paneId);
    }
  }
  return { sessions };
}),

registerWs: (paneId, ws) => {
  wsRefs.set(paneId, ws);
},

getWs: (paneId) => {
  return wsRefs.get(paneId);
},
```

The terminal component calls `registerWs(paneId, ws)` after the WebSocket connects, so `switchProject` can access the WS to hand it off to `backgroundTerminalStore`.

- [ ] **Step 2: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/stores/terminalStore.ts
git commit -m "feat: add projectId tracking to terminal store"
```

---

## Task 9: Update Project Store with switchProject

**Files:**
- Modify: `frontend/src/stores/projectStore.ts`

- [ ] **Step 1: Extend project store with layout management**

This is the orchestration center. Rewrite `frontend/src/stores/projectStore.ts` to add:
- `projectLayouts` map
- `projectBranches` map
- `isSwitching` guard
- `switchProject()` — the full save/restore flow
- `saveCurrentLayout()` — snapshot current state
- `restoreLayout()` — restore a saved layout
- `updateProject()` — call backend Update
- `pollBranches()` — git branch polling

```typescript
import { create } from 'zustand';
import type { Project, ProjectLayout, EditorTabSnapshot, TerminalPositionSnapshot, UpdateFields } from '../lib/types';
import { useLayoutStore } from './layoutStore';
import { useEditorStore } from './editorStore';
import { useTerminalStore } from './terminalStore';
import { useBackgroundTerminalStore } from './backgroundTerminalStore';

interface ProjectState {
  projects: Project[];
  activeProjectId: number | null;
  projectLayouts: Map<number, ProjectLayout>;
  projectBranches: Map<number, string>;
  isSwitching: boolean;

  loadProjects: () => Promise<void>;
  addProject: (name: string, path: string) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  updateProject: (id: number, fields: UpdateFields) => Promise<void>;
  switchProject: (id: number) => Promise<void>;
  setActiveProject: (id: number) => void;
  getActiveProject: () => Project | undefined;
  saveCurrentLayout: () => void;
  restoreLayout: (projectId: number) => Promise<void>;
  pollBranches: () => Promise<void>;
  loadSavedLayouts: () => Promise<void>;
  persistLayout: (projectId: number) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  projectLayouts: new Map(),
  projectBranches: new Map(),
  isSwitching: false,

  loadProjects: async () => {
    try {
      const projects = await window.go.main.App.ListProjects();
      set({ projects: projects || [] });
      const state = get();
      if (!state.activeProjectId && projects && projects.length > 0) {
        set({ activeProjectId: projects[0].id });
        useLayoutStore.getState().createProjectLayout();
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  },

  addProject: async (name, path) => {
    try {
      await window.go.main.App.AddProject(name, path);
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  },

  deleteProject: async (id) => {
    try {
      await window.go.main.App.DeleteProject(id);
      useBackgroundTerminalStore.getState().removeByProject(id);
      const layouts = new Map(get().projectLayouts);
      layouts.delete(id);
      const state = get();
      if (state.activeProjectId === id) {
        const remaining = state.projects.filter(p => p.id !== id);
        if (remaining.length > 0) {
          set({ activeProjectId: null, projectLayouts: layouts });
          await get().switchProject(remaining[0].id);
        } else {
          set({ activeProjectId: null, projectLayouts: layouts });
        }
      } else {
        set({ projectLayouts: layouts });
      }
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  },

  updateProject: async (id, fields) => {
    try {
      await window.go.main.App.UpdateProject(id, fields);
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  },

  setActiveProject: (id) => {
    const wasNull = get().activeProjectId === null;
    set({ activeProjectId: id });
    if (wasNull) {
      useLayoutStore.getState().createProjectLayout();
    }
  },

  switchProject: async (id) => {
    const state = get();
    if (state.isSwitching || state.activeProjectId === id) return;

    set({ isSwitching: true });
    try {
      // Save current layout
      if (state.activeProjectId !== null) {
        get().saveCurrentLayout();
        await get().persistLayout(state.activeProjectId);

        // Detach all terminals for the current project to background store.
        // This must happen BEFORE React unmounts the terminal components
        // (which happens when we replace layoutStore.root below).
        // We emit a custom event that terminal components listen for —
        // they call detach() on their useTerminal hook, which prevents
        // the cleanup handler from closing the WS and killing the PTY.
        // Then we move the WS connections into backgroundTerminalStore.
        const termStore = useTerminalStore.getState();
        const bgStore = useBackgroundTerminalStore.getState();
        const currentSessions = Array.from(termStore.sessions.values())
          .filter(s => s.projectId === state.activeProjectId);

        // Emit detach event — terminal components listen for this
        window.dispatchEvent(new CustomEvent('quarterdeck:detach-terminals', {
          detail: { projectId: state.activeProjectId },
        }));

        // Small yield to let React process the event synchronously
        await new Promise(r => setTimeout(r, 0));

        // Now the terminal components have called detach() on their hooks.
        // Move the WebSocket connections to background store.
        // The WS refs are stored in terminalStore by the terminal components
        // via a registerWs() call added in Task 15.
        for (const session of currentSessions) {
          const wsRef = termStore.getWs(session.paneId);
          if (wsRef) {
            bgStore.detach(session.id, session.projectId, wsRef, session.command);
          }
        }

        // Clear foreground terminal state for old project
        termStore.clearByProject(state.activeProjectId!);
      }

      // Switch
      set({ activeProjectId: id });

      // Clear new output flag for the target project
      useBackgroundTerminalStore.getState().clearNewOutput(id);

      // Restore target layout
      await get().restoreLayout(id);
    } finally {
      set({ isSwitching: false });
    }
  },

  saveCurrentLayout: () => {
    const state = get();
    if (state.activeProjectId === null) return;

    const layoutStore = useLayoutStore.getState();
    const editorStore = useEditorStore.getState();
    const terminalStore = useTerminalStore.getState();

    // Build editor tab snapshots
    const editorTabs: EditorTabSnapshot[] = editorStore.openFiles.map((file, _i) => ({
      paneId: '', // Will be enhanced when we wire Monaco cursor capture
      filePath: file.path,
      cursorPosition: { line: 1, column: 1 }, // Default; enhanced later with Monaco integration
      scrollPosition: 0,
      dirtyContent: file.modified ? file.content : null,
    }));

    // Build terminal position snapshots
    const terminalPositions: TerminalPositionSnapshot[] = [];
    for (const [_paneId, session] of terminalStore.sessions) {
      terminalPositions.push({
        sessionId: session.id,
        paneId: session.paneId,
        tabIndex: 0,
      });
    }

    const layout: ProjectLayout = {
      projectId: state.activeProjectId,
      tilingTree: layoutStore.root,
      editorTabs,
      activeEditorTab: editorStore.activeFileIndex >= 0
        ? editorStore.openFiles[editorStore.activeFileIndex]?.path || null
        : null,
      terminalPositions,
    };

    const layouts = new Map(state.projectLayouts);
    layouts.set(state.activeProjectId, layout);
    set({ projectLayouts: layouts });
  },

  restoreLayout: async (projectId) => {
    const state = get();
    const layout = state.projectLayouts.get(projectId);

    if (!layout) {
      // First-time project — create default layout
      useLayoutStore.getState().createProjectLayout();
      useEditorStore.getState().replaceAll([], -1);
      useTerminalStore.getState().clearByProject(projectId);
      return;
    }

    // Restore tiling tree
    useLayoutStore.getState().setRoot(layout.tilingTree);

    // Restore editor tabs
    const files = [];
    for (const tab of layout.editorTabs) {
      try {
        let content: string;
        if (tab.dirtyContent !== null) {
          content = tab.dirtyContent;
        } else {
          content = await window.go.main.App.ReadFile(tab.filePath);
        }
        const name = tab.filePath.split('/').pop() || tab.filePath;
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
          go: 'go', py: 'python', rs: 'rust', json: 'json', yaml: 'yaml', yml: 'yaml',
          md: 'markdown', html: 'html', css: 'css', sql: 'sql', sh: 'shell',
          toml: 'toml', xml: 'xml', svg: 'xml',
        };
        files.push({
          path: tab.filePath,
          name,
          content,
          language: langMap[ext] || 'plaintext',
          modified: tab.dirtyContent !== null,
        });
      } catch {
        // File may have been deleted — skip it
      }
    }

    const activeIdx = layout.activeEditorTab
      ? files.findIndex(f => f.path === layout.activeEditorTab)
      : -1;
    useEditorStore.getState().replaceAll(files, activeIdx >= 0 ? activeIdx : (files.length > 0 ? 0 : -1));

    // Terminal reattachment is handled by the terminal components when they mount
    // (they check backgroundTerminalStore for existing sessions)
  },

  pollBranches: async () => {
    const state = get();
    const branches = new Map<number, string>();
    for (const project of state.projects) {
      try {
        const branch = await window.go.main.App.GetGitBranch(project.path);
        branches.set(project.id, branch);
      } catch {
        branches.set(project.id, '');
      }
    }
    set({ projectBranches: branches });
  },

  loadSavedLayouts: async () => {
    try {
      const all = await window.go.main.App.GetAllLayouts();
      const layouts = new Map<number, ProjectLayout>();
      for (const [idStr, json] of Object.entries(all || {})) {
        try {
          layouts.set(Number(idStr), JSON.parse(json));
        } catch { /* skip corrupt layouts */ }
      }
      set({ projectLayouts: layouts });
    } catch (err) {
      console.error('Failed to load saved layouts:', err);
    }
  },

  persistLayout: async (projectId) => {
    const layout = get().projectLayouts.get(projectId);
    if (!layout) return;
    try {
      await window.go.main.App.SaveLayout(projectId, JSON.stringify(layout));
    } catch (err) {
      console.error('Failed to persist layout:', err);
    }
  },

  getActiveProject: () => {
    const state = get();
    return state.projects.find(p => p.id === state.activeProjectId);
  },
}));
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds (may have warnings, no errors)

- [ ] **Step 3: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/stores/projectStore.ts
git commit -m "feat: project store with switchProject, layout save/restore, branch polling"
```

---

## Task 10: Add Project Modal

**Files:**
- Create: `frontend/src/components/sidebar/AddProjectModal.tsx`
- Modify: `frontend/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Create AddProjectModal component**

Create `frontend/src/components/sidebar/AddProjectModal.tsx`:

```typescript
import React, { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';

export function AddProjectModal() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const addProject = useProjectStore(s => s.addProject);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');

  if (active !== 'addProject') return null;

  const handleBrowse = async () => {
    try {
      // Wails v2 runtime.OpenDirectoryDialog
      const selected = await (window as any).runtime.OpenDirectoryDialog({
        title: 'Select Project Directory',
      });
      if (selected) {
        setPath(selected);
        if (!name) {
          setName(selected.split('/').pop() || selected);
        }
      }
    } catch {
      // Fallback: if runtime dialog not available, prompt
      const p = window.prompt('Enter project directory path:');
      if (p) {
        setPath(p.trim());
        if (!name) {
          setName(p.trim().split('/').pop() || p.trim());
        }
      }
    }
  };

  const handlePathChange = (val: string) => {
    setPath(val);
    if (!name || name === path.split('/').pop()) {
      setName(val.split('/').pop() || val);
    }
  };

  const handleSubmit = async () => {
    if (!path.trim() || !name.trim()) return;
    await addProject(name.trim(), path.trim());
    setPath('');
    setName('');
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') handleSubmit();
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
        borderRadius: '8px', padding: '24px', width: '400px',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, marginBottom: '16px' }}>
          Add Project
        </div>

        {/* Directory field */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Directory
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="/home/user/project"
              autoFocus
              style={{
                flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
                borderRadius: '4px', padding: '8px 10px', color: 'var(--text-primary)',
                fontSize: '12px', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleBrowse}
              style={{
                background: 'var(--bg-active)', color: 'var(--text-primary)',
                border: 'none', borderRadius: '4px', padding: '8px 12px',
                fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Name field */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: '4px', padding: '8px 10px', color: 'var(--text-primary)',
              fontSize: '12px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

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
            onClick={handleSubmit}
            style={{
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '4px',
              padding: '8px 16px', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update Sidebar to use modal and overlay store**

In `Sidebar.tsx`, replace the `handleAddProject` function to use the overlay store:

```typescript
import { useOverlayStore } from '../../stores/overlayStore';
```

Replace `handleAddProject`:
```typescript
const openAddProject = useOverlayStore(s => s.open);

const handleAddProject = () => {
  openAddProject('addProject');
};
```

- [ ] **Step 3: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/sidebar/AddProjectModal.tsx frontend/src/components/sidebar/Sidebar.tsx
git commit -m "feat: add project modal with directory picker"
```

---

## Task 11: Context Menu & Sidebar Project Entries

**Files:**
- Create: `frontend/src/components/sidebar/ContextMenu.tsx`
- Create: `frontend/src/components/sidebar/ProjectEntry.tsx`
- Modify: `frontend/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Create ContextMenu component**

Create `frontend/src/components/sidebar/ContextMenu.tsx`:

```typescript
import React, { useEffect, useRef } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 2000,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '4px', padding: '4px 0', minWidth: '160px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => { item.onClick(); onClose(); }}
          style={{
            padding: '6px 12px', cursor: 'pointer', fontSize: '12px',
            color: item.danger ? '#f87171' : 'var(--text-primary)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-active)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectEntry component**

Create `frontend/src/components/sidebar/ProjectEntry.tsx`:

```typescript
import React, { useState, useRef, useCallback } from 'react';
import type { Project } from '../../lib/types';
import { getProjectColor } from '../../lib/projectColors';
import { useProjectStore } from '../../stores/projectStore';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { ContextMenu } from './ContextMenu';

interface ProjectEntryProps {
  project: Project;
  isActive: boolean;
  branch: string;
  onSwitch: () => void;
  onRemove: () => void;
  onSettings: () => void;
}

export function ProjectEntry({ project, isActive, branch, onSwitch, onRemove, onSettings }: ProjectEntryProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateProject = useProjectStore(s => s.updateProject);

  // Terminal counts
  const bgTerminals = useBackgroundTerminalStore(s => s.getByProject(project.id));
  const activeTerminals = useTerminalStore(s => s.getSessionsByProject(project.id));
  const termCount = isActive ? activeTerminals.length : bgTerminals.length;

  // Activity indicator
  const hasNewOutput = useBackgroundTerminalStore(s => s.hasNewOutput(project.id));
  const lastTimestamp = useBackgroundTerminalStore(s => s.getProjectOutputTimestamp(project.id));
  const allExited = bgTerminals.length > 0 && bgTerminals.every(t => t.exitInfo !== null);

  const color = getProjectColor(project.sortOrder, project.color || null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRenameSubmit = async () => {
    if (renameValue.trim() && renameValue !== project.name) {
      await updateProject(project.id, { name: renameValue.trim() });
    }
    setIsRenaming(false);
  };

  const startRename = () => {
    setRenameValue(project.name);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // Activity dot color
  let dotColor: string | null = null;
  if (!isActive && hasNewOutput) {
    const isRecent = lastTimestamp && (Date.now() - lastTimestamp) < 30000;
    dotColor = isRecent ? '#facc15' : '#a3863a';
  } else if (!isActive && allExited) {
    dotColor = '#64748b';
  }

  return (
    <>
      <div
        onClick={onSwitch}
        onContextMenu={handleContextMenu}
        style={{
          display: 'flex', alignItems: 'center', padding: '8px 12px',
          cursor: 'pointer', borderLeft: `3px solid ${color}`,
          background: isActive ? 'var(--bg-active)' : 'transparent',
          gap: '8px',
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                autoFocus
                style={{
                  background: 'var(--bg-primary)', border: '1px solid var(--accent)',
                  borderRadius: '2px', padding: '1px 4px', fontSize: '13px',
                  color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
                  width: '100%',
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span style={{
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 500 : 400, fontSize: '13px',
              }}>
                {project.name}
              </span>
            )}
            {dotColor && (
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: dotColor, flexShrink: 0,
              }} />
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', gap: '8px', opacity: 0.6 }}>
            {branch && <span>{branch}</span>}
            {termCount > 0 && <span>{termCount} term{termCount !== 1 ? 's' : ''}</span>}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Rename', onClick: startRename },
            { label: 'Settings', onClick: onSettings },
            { label: 'Remove', onClick: onRemove, danger: true },
          ]}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Update Sidebar to use ProjectEntry**

Rewrite the project list section in `Sidebar.tsx` to use `ProjectEntry` instead of the plain div:

```typescript
import { ProjectEntry } from './ProjectEntry';
```

Replace the project list map with:
```typescript
{projects.map(project => (
  <ProjectEntry
    key={project.id}
    project={project}
    isActive={project.id === activeProjectId}
    branch={projectBranches.get(project.id) || ''}
    onSwitch={() => switchProject(project.id)}
    onRemove={() => {
      if (window.confirm('Remove from Quarterdeck? Files won\'t be deleted.')) {
        deleteProject(project.id);
      }
    }}
    onSettings={() => {
      // TODO: Open project settings tab (Task 14)
    }}
  />
))}
```

Wire up `switchProject`, `projectBranches`, and `deleteProject` from the project store. Add the file tree label showing "FILES — {project.name}".

Also add git branch polling:
```typescript
useEffect(() => {
  pollBranches();
  const interval = setInterval(pollBranches, 15000);
  return () => clearInterval(interval);
}, [projects.length]);
```

- [ ] **Step 4: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/sidebar/ContextMenu.tsx frontend/src/components/sidebar/ProjectEntry.tsx frontend/src/components/sidebar/Sidebar.tsx
git commit -m "feat: rich project sidebar entries with context menu, colors, activity indicators"
```

---

## Task 12: Overlay Container & Project Switcher

**Files:**
- Create: `frontend/src/components/overlay/OverlayContainer.tsx`
- Create: `frontend/src/components/overlay/ProjectSwitcher.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create OverlayContainer**

Create `frontend/src/components/overlay/OverlayContainer.tsx`:

```typescript
import React from 'react';
import { useOverlayStore } from '../../stores/overlayStore';

interface OverlayContainerProps {
  children: React.ReactNode;
}

export function OverlayContainer({ children }: OverlayContainerProps) {
  const close = useOverlayStore(s => s.close);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '80px', background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectSwitcher**

Create `frontend/src/components/overlay/ProjectSwitcher.tsx`:

```typescript
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { fuzzyMatch } from '../../lib/fuzzyMatch';
import { getProjectColor } from '../../lib/projectColors';
import { OverlayContainer } from './OverlayContainer';

export function ProjectSwitcher() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const projects = useProjectStore(s => s.projects);
  const switchProject = useProjectStore(s => s.switchProject);
  const projectBranches = useProjectStore(s => s.projectBranches);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active === 'projectSwitcher') {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [active]);

  const filteredProjects = query
    ? projects
        .map(p => ({ project: p, result: fuzzyMatch(query, p.name) }))
        .filter(r => r.result !== null)
        .sort((a, b) => (b.result!.score - a.result!.score))
        .map(r => ({ project: r.project, matches: r.result!.matches }))
    : projects.map(p => ({ project: p, matches: [] as number[] }));

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredProjects.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredProjects[selectedIndex];
      if (selected) {
        switchProject(selected.project.id);
        close();
      }
    }
  }, [filteredProjects, selectedIndex, close, switchProject]);

  if (active !== 'projectSwitcher') return null;

  return (
    <OverlayContainer>
      <div style={{
        width: '480px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '8px', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>&gt;</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Switch project..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {filteredProjects.map(({ project, matches }, i) => {
            const color = getProjectColor(project.sortOrder, project.color || null);
            const branch = projectBranches.get(project.id) || '';
            const bgTerminals = useBackgroundTerminalStore.getState().getByProject(project.id);
            const activeTerminals = useTerminalStore.getState().getSessionsByProject(project.id);
            const termCount = project.id === useProjectStore.getState().activeProjectId
              ? activeTerminals.length : bgTerminals.length;
            const hasNew = useBackgroundTerminalStore.getState().hasNewOutput(project.id);

            // Render name with fuzzy highlights
            const nameChars = project.name.split('').map((ch, ci) => (
              <span key={ci} style={{
                color: matches.includes(ci) ? 'var(--accent)' : undefined,
                fontWeight: matches.includes(ci) ? 600 : undefined,
              }}>
                {ch}
              </span>
            ));

            return (
              <div
                key={project.id}
                onClick={() => { switchProject(project.id); close(); }}
                style={{
                  display: 'flex', alignItems: 'center', padding: '10px 16px',
                  background: i === selectedIndex ? 'var(--bg-active)' : 'transparent',
                  cursor: 'pointer', gap: '12px',
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: color, flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{nameChars}</span>
                    {hasNew && (
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#facc15', flexShrink: 0,
                      }} />
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {project.path.replace(/^\/home\/[^/]+/, '~')} {branch && `· ${branch}`} {termCount > 0 && `· ${termCount} terminal${termCount !== 1 ? 's' : ''}`}
                  </div>
                </div>
                {i === selectedIndex && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '11px', flexShrink: 0 }}>Enter</span>
                )}
              </div>
            );
          })}
          {filteredProjects.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              No matching projects
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-secondary)',
        }}>
          <span><span style={{ opacity: 0.7 }}>Up/Down</span> navigate</span>
          <span><span style={{ opacity: 0.7 }}>Enter</span> switch</span>
          <span><span style={{ opacity: 0.7 }}>Esc</span> dismiss</span>
        </div>
      </div>
    </OverlayContainer>
  );
}
```

- [ ] **Step 3: Wire overlays and keyboard shortcuts into App.tsx**

In `App.tsx`:

Add imports:
```typescript
import { useOverlayStore } from './stores/overlayStore';
import { AddProjectModal } from './components/sidebar/AddProjectModal';
import { ProjectSwitcher } from './components/overlay/ProjectSwitcher';
```

Add overlay toggle to store access:
```typescript
const toggleOverlay = useOverlayStore(s => s.toggle);
```

Add keyboard shortcut cases in `handleKeyDown`:
```typescript
case 'P':
  e.preventDefault();
  toggleOverlay('projectSwitcher');
  break;
case 'O':
  e.preventDefault();
  toggleOverlay('addProject');
  break;
```

Note: These are inside the existing `if (!e.ctrlKey || !e.shiftKey) return;` block, so they trigger on `Ctrl+Shift+P` and `Ctrl+Shift+O`.

Add `Ctrl+P` handler (before the `!e.ctrlKey || !e.shiftKey` guard, since `Ctrl+P` doesn't use Shift):
```typescript
if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
  e.preventDefault();
  toggleOverlay('fileSearch');
  return;
}
```

Add modals to the JSX (inside the outer div, after the flex layout):
```tsx
<AddProjectModal />
<ProjectSwitcher />
```

- [ ] **Step 4: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/overlay/ frontend/src/App.tsx
git commit -m "feat: project switcher overlay with fuzzy search (Ctrl+Shift+P)"
```

---

## Task 13: File Search Overlay

**Files:**
- Modify: `app.go`
- Modify: `internal/filetree/service.go`
- Create: `internal/filetree/service_test.go`
- Create: `frontend/src/components/overlay/FileSearch.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 0: Write failing test for ListFiles**

Create `internal/filetree/service_test.go`:

```go
package filetree

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListFiles(t *testing.T) {
	dir := t.TempDir()

	// Create test directory structure
	os.MkdirAll(filepath.Join(dir, "src"), 0755)
	os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0755)
	os.MkdirAll(filepath.Join(dir, ".git"), 0755)
	os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0644)
	os.WriteFile(filepath.Join(dir, "src", "app.ts"), []byte("export {}"), 0644)
	os.WriteFile(filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, ".git", "config"), []byte(""), 0644)

	svc := NewService()
	files, err := svc.ListFiles(dir)
	if err != nil {
		t.Fatalf("ListFiles failed: %v", err)
	}

	// Should include main.go and src/app.ts
	// Should NOT include node_modules or .git files
	found := map[string]bool{}
	for _, f := range files {
		found[f] = true
	}

	if !found["main.go"] {
		t.Error("expected main.go in results")
	}
	if !found[filepath.Join("src", "app.ts")] {
		t.Errorf("expected src/app.ts in results")
	}
	if found[filepath.Join("node_modules", "pkg", "index.js")] {
		t.Error("node_modules should be excluded")
	}
	if found[filepath.Join(".git", "config")] {
		t.Error(".git should be excluded")
	}
}
```

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/filetree/ -v -run TestListFiles`
Expected: FAIL — `ListFiles` method not found

- [ ] **Step 1: Add ListProjectFiles backend method**

Add to `app.go`:
```go
func (a *App) ListProjectFiles(projectPath string) ([]string, error) {
	cmd := exec.Command("git", "ls-files")
	cmd.Dir = projectPath
	output, err := cmd.Output()
	if err != nil {
		// Fall back to file tree walk
		return a.fileTree.ListFiles(projectPath)
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return []string{}, nil
	}
	return lines, nil
}
```

Add `ListFiles` method to `internal/filetree/service.go`:
```go
func (s *Service) ListFiles(rootPath string) ([]string, error) {
	var files []string
	err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		name := info.Name()
		if info.IsDir() {
			// Skip hidden and build dirs
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "__pycache__" || name == "target" || name == "dist" || name == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") {
			return nil
		}
		rel, _ := filepath.Rel(rootPath, path)
		files = append(files, rel)
		return nil
	})
	return files, err
}
```

Ensure these imports are present in `filetree/service.go`: `"os"`, `"path/filepath"`, `"strings"`.

- [ ] **Step 1b: Run ListFiles test to verify it passes**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./internal/filetree/ -v -run TestListFiles`
Expected: PASS

- [ ] **Step 2: Create FileSearch overlay component**

Create `frontend/src/components/overlay/FileSearch.tsx`:

```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { useEditorStore } from '../../stores/editorStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { fuzzyMatch } from '../../lib/fuzzyMatch';
import { OverlayContainer } from './OverlayContainer';

export function FileSearch() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const activeProject = useProjectStore(s => s.getActiveProject());
  const openFile = useEditorStore(s => s.openFile);
  const addTab = useLayoutStore(s => s.addTab);
  const getEditorPaneId = useLayoutStore(s => s.getEditorPaneId);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileList, setFileList] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active === 'fileSearch' && activeProject) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      // Load file list
      window.go.main.App.ListProjectFiles(activeProject.path)
        .then(files => setFileList(files || []))
        .catch(() => setFileList([]));
    }
  }, [active, activeProject?.id]);

  const filtered = query
    ? fileList
        .map(f => ({ path: f, result: fuzzyMatch(query, f) }))
        .filter(r => r.result !== null)
        .sort((a, b) => b.result!.score - a.result!.score)
        .slice(0, 50) // Cap results for performance
        .map(r => ({ path: r.path, matches: r.result!.matches }))
    : fileList.slice(0, 50).map(f => ({ path: f, matches: [] as number[] }));

  const handleSelect = useCallback(async (relPath: string) => {
    if (!activeProject) return;
    const fullPath = `${activeProject.path}/${relPath}`;
    try {
      const content = await window.go.main.App.ReadFile(fullPath);
      openFile(fullPath, content);
      const targetPaneId = getEditorPaneId() || focusedPaneId;
      const filename = relPath.split('/').pop() || relPath;
      addTab(targetPaneId, { type: 'editor', title: filename, filePath: fullPath });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
    close();
  }, [activeProject, openFile, addTab, getEditorPaneId, focusedPaneId, close]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) handleSelect(selected.path);
    }
  }, [filtered, selectedIndex, close, handleSelect]);

  if (active !== 'fileSearch') return null;

  return (
    <OverlayContainer>
      <div style={{
        width: '520px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '8px', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>#</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder={`Find file in ${activeProject?.name || 'project'}...`}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
          {filtered.map(({ path, matches }, i) => {
            const chars = path.split('').map((ch, ci) => (
              <span key={ci} style={{
                color: matches.includes(ci) ? 'var(--accent)' : undefined,
                fontWeight: matches.includes(ci) ? 600 : undefined,
              }}>
                {ch}
              </span>
            ));

            return (
              <div
                key={path}
                onClick={() => handleSelect(path)}
                style={{
                  padding: '8px 16px', cursor: 'pointer', fontSize: '13px',
                  color: 'var(--text-primary)',
                  background: i === selectedIndex ? 'var(--bg-active)' : 'transparent',
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {chars}
              </div>
            );
          })}
          {filtered.length === 0 && query && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              No matching files
            </div>
          )}
        </div>

        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-secondary)',
        }}>
          <span><span style={{ opacity: 0.7 }}>Up/Down</span> navigate</span>
          <span><span style={{ opacity: 0.7 }}>Enter</span> open</span>
          <span><span style={{ opacity: 0.7 }}>Esc</span> dismiss</span>
        </div>
      </div>
    </OverlayContainer>
  );
}
```

- [ ] **Step 3: Add FileSearch to App.tsx**

Import and render:
```typescript
import { FileSearch } from './components/overlay/FileSearch';
```
```tsx
<FileSearch />
```

- [ ] **Step 4: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 5: Verify frontend builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add app.go internal/filetree/service.go frontend/src/components/overlay/FileSearch.tsx frontend/src/App.tsx
git commit -m "feat: file search overlay with Ctrl+P (git ls-files + fuzzy match)"
```

---

## Task 14: Project Settings Panel

**Files:**
- Create: `frontend/src/components/settings/ProjectSettings.tsx`
- Modify: `frontend/src/components/layout/Pane.tsx`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add 'settings' to PaneType**

In `frontend/src/lib/types.ts`, update `PaneType`:
```typescript
export type PaneType = 'terminal' | 'editor' | 'settings';
```

Add `projectId` to `PanelTab`:
```typescript
export interface PanelTab {
  id: string;
  type: PaneType;
  title: string;
  terminalId?: string;
  filePath?: string;
  projectId?: number;
}
```

- [ ] **Step 2: Create ProjectSettings component**

Create `frontend/src/components/settings/ProjectSettings.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { Project } from '../../lib/types';

interface ProjectSettingsProps {
  projectId: number;
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const projects = useProjectStore(s => s.projects);
  const updateProject = useProjectStore(s => s.updateProject);
  const project = projects.find(p => p.id === projectId);

  const [form, setForm] = useState({
    name: '', gitDefaultBranch: '', devServerUrl: '',
    devServerCommand: '', defaultAgentType: '', notes: '',
  });

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        gitDefaultBranch: project.gitDefaultBranch,
        devServerUrl: project.devServerUrl,
        devServerCommand: project.devServerCommand,
        defaultAgentType: project.defaultAgentType,
        notes: project.notes,
      });
    }
  }, [project?.id]);

  if (!project) {
    return <div style={{ padding: '16px', color: 'var(--text-secondary)' }}>Project not found</div>;
  }

  const handleSave = () => {
    updateProject(projectId, {
      name: form.name,
      gitDefaultBranch: form.gitDefaultBranch,
      devServerUrl: form.devServerUrl,
      devServerCommand: form.devServerCommand,
      defaultAgentType: form.defaultAgentType,
      notes: form.notes,
    });
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: '4px', padding: '8px 10px', color: 'var(--text-primary)',
    fontSize: '13px', outline: 'none', fontFamily: 'JetBrains Mono, monospace',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
  };

  return (
    <div style={{ padding: '24px', maxWidth: '500px', overflowY: 'auto', height: '100%' }}>
      <h2 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 500, marginBottom: '20px' }}>
        Project Settings
      </h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Name</label>
        <input style={fieldStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Path</label>
        <input style={{ ...fieldStyle, opacity: 0.6 }} value={project.path} readOnly />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Git Default Branch</label>
        <input style={fieldStyle} value={form.gitDefaultBranch} onChange={e => setForm({ ...form, gitDefaultBranch: e.target.value })} />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Dev Server URL</label>
        <input style={fieldStyle} value={form.devServerUrl} onChange={e => setForm({ ...form, devServerUrl: e.target.value })} placeholder="http://localhost:3000" />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Dev Server Command</label>
        <input style={fieldStyle} value={form.devServerCommand} onChange={e => setForm({ ...form, devServerCommand: e.target.value })} placeholder="npm run dev" />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>Default Agent Type</label>
        <input style={fieldStyle} value={form.defaultAgentType} onChange={e => setForm({ ...form, defaultAgentType: e.target.value })} placeholder="claude-code" />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={labelStyle}>Notes</label>
        <textarea
          style={{ ...fieldStyle, minHeight: '80px', resize: 'vertical' }}
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <button
        onClick={handleSave}
        style={{
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: '4px', padding: '8px 20px', fontSize: '13px',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Save
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Update Pane.tsx to render settings tabs**

In `Pane.tsx`, add import:
```typescript
import { ProjectSettings } from '../settings/ProjectSettings';
```

Add a case in the tab content rendering (alongside the terminal and editor cases):
```tsx
{tab.type === 'settings' && tab.projectId ? (
  <ProjectSettings projectId={tab.projectId} />
) : tab.type === 'terminal' ? (
  <TerminalPanel workDir={activeProject?.path || '/tmp'} />
) : (
  <MonacoEditor filePath={tab.filePath} />
)}
```

- [ ] **Step 4: Wire "Settings" context menu action in Sidebar**

In the `onSettings` callback in `Sidebar.tsx`, open a settings tab:
```typescript
onSettings={() => {
  const targetPaneId = getEditorPaneId() || focusedPaneId;
  addTab(targetPaneId, {
    type: 'settings',
    title: `${project.name} Settings`,
    projectId: project.id,
  });
}}
```

- [ ] **Step 5: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/settings/ProjectSettings.tsx frontend/src/components/layout/Pane.tsx frontend/src/lib/types.ts frontend/src/components/sidebar/Sidebar.tsx
git commit -m "feat: project settings panel as editor tab"
```

---

## Task 15: Terminal Reattach & Exit Handling

**Files:**
- Create: `frontend/src/components/terminal/TerminalExited.tsx`
- Modify: `frontend/src/components/terminal/Terminal.tsx`
- Modify: `frontend/src/hooks/useTerminal.ts`

- [ ] **Step 1: Create TerminalExited component**

Create `frontend/src/components/terminal/TerminalExited.tsx`:

```typescript
import React from 'react';

interface TerminalExitedProps {
  exitCode: number;
  command: string;
  onRestart: () => void;
}

export function TerminalExited({ exitCode, command, onRestart }: TerminalExitedProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '12px',
      color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{ fontSize: '13px' }}>
        [session ended — exit {exitCode}] {command}
      </div>
      <button
        onClick={onRestart}
        style={{
          background: 'var(--bg-active)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: '4px',
          padding: '6px 16px', fontSize: '12px', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Restart
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update useTerminal to support reattach mode**

Modify `frontend/src/hooks/useTerminal.ts` to accept an optional `existingSession` prop for reattachment:

Add to the options interface:
```typescript
interface UseTerminalOptions {
  workDir: string;
  existingWs?: WebSocket;
  existingBuffer?: Uint8Array[];
  onReady?: () => void;
  onSessionId?: (id: string) => void;
}
```

In the `connect` function, before creating a new terminal, check if `options.existingWs` is provided. If so, skip `CreateTerminal` and WebSocket creation — wire the existing WS to xterm instead:

```typescript
if (options.existingWs) {
  const socket = options.existingWs;
  socketRef.current = socket;

  // Feed buffered output first (hidden render)
  if (options.existingBuffer) {
    for (const chunk of options.existingBuffer) {
      term.write(chunk);
    }
  }

  // Rewire WS handlers
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data));
    } else if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'exited') {
          term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
        }
      } catch { }
    }
  };

  // Terminal input -> WS
  term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      const encoder = new TextEncoder();
      socket.send(encoder.encode(data));
    }
  });

  term.onResize(({ cols, rows }) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  term.focus();
  options.onReady?.();
  return; // Skip normal connect flow
}
```

Also add a `detach()` function that prevents the cleanup from destroying the WS and PTY. This is critical — when `switchProject` replaces the layout, React unmounts terminal components. Without detach mode, the cleanup handler would close the WebSocket and kill the PTY process, defeating background terminals entirely.

Add a `detachedRef` to prevent cleanup:
```typescript
const detachedRef = useRef(false);
```

Modify the cleanup to check detach state:
```typescript
return () => {
  observer.disconnect();
  if (!detachedRef.current) {
    // Normal cleanup — close everything
    if (socketRef.current) {
      socketRef.current.close();
    }
    if (sessionIdRef.current) {
      window.go.main.App.CloseTerminal(sessionIdRef.current).catch(() => {});
    }
  }
  // Always dispose xterm.js instance (DOM cleanup)
  term.dispose();
};
```

Expose detach and refs:
```typescript
return {
  terminal: terminalRef,
  fit: useCallback(() => fitAddonRef.current?.fit(), []),
  sessionId: sessionIdRef,
  socket: socketRef,
  detach: useCallback(() => { detachedRef.current = true; }, []),
};
```

The `detach()` function is called by the terminal component before the project switch triggers unmount. Once called, the cleanup skips WS close and PTY kill — the WS is handed off to `backgroundTerminalStore` instead.

- [ ] **Step 3: Update Terminal.tsx to handle reattach and exit states**

Update `frontend/src/components/terminal/Terminal.tsx`:

```typescript
import React, { useRef, useState } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { TerminalExited } from './TerminalExited';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  workDir?: string;
  reattachSessionId?: string;
}

export function TerminalPanel({ workDir = '/tmp', reattachSessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; command: string } | null>(null);
  const [key, setKey] = useState(0); // Force remount on restart

  // Check if we should reattach
  const bgStore = useBackgroundTerminalStore.getState();
  let existingWs: WebSocket | undefined;
  let existingBuffer: Uint8Array[] | undefined;
  let bgExitInfo: { code: number; command: string } | null = null;

  if (reattachSessionId) {
    const bg = bgStore.terminals.get(reattachSessionId);
    if (bg) {
      if (bg.exitInfo) {
        bgExitInfo = bg.exitInfo;
      } else {
        const reattached = bgStore.reattach(reattachSessionId);
        if (reattached) {
          existingWs = reattached.ws;
          existingBuffer = reattached.buffer;
        }
      }
    }
  }

  // Show exit state if background terminal died
  if (bgExitInfo || exitInfo) {
    const info = bgExitInfo || exitInfo!;
    return (
      <TerminalExited
        exitCode={info.code}
        command={info.command}
        onRestart={() => {
          setExitInfo(null);
          setKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <TerminalPanelInner
      key={key}
      containerRef={containerRef}
      workDir={workDir}
      existingWs={existingWs}
      existingBuffer={existingBuffer}
    />
  );
}

function TerminalPanelInner({ containerRef, workDir, existingWs, existingBuffer }: {
  containerRef: React.RefObject<HTMLDivElement>;
  workDir: string;
  existingWs?: WebSocket;
  existingBuffer?: Uint8Array[];
}) {
  useTerminal(containerRef, { workDir, existingWs, existingBuffer });

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
```

- [ ] **Step 4: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/terminal/TerminalExited.tsx frontend/src/components/terminal/Terminal.tsx frontend/src/hooks/useTerminal.ts
git commit -m "feat: terminal reattach from background store and exit state with restart"
```

---

## Task 16: Auto-Save & App Startup Integration

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Add layout auto-save and startup loading to App.tsx**

In `App.tsx`, add on mount:
```typescript
import { useProjectStore } from './stores/projectStore';

// Inside App component:
const loadSavedLayouts = useProjectStore(s => s.loadSavedLayouts);
const saveCurrentLayout = useProjectStore(s => s.saveCurrentLayout);
const persistLayout = useProjectStore(s => s.persistLayout);
const activeProjectId = useProjectStore(s => s.activeProjectId);

// Load saved layouts on startup
useEffect(() => {
  loadSavedLayouts();
}, []);

// Auto-save layout every 60 seconds
useEffect(() => {
  const interval = setInterval(() => {
    if (activeProjectId !== null) {
      saveCurrentLayout();
      persistLayout(activeProjectId);
    }
  }, 60000);
  return () => clearInterval(interval);
}, [activeProjectId]);
```

- [ ] **Step 2: Update StatusBar with project color**

In `StatusBar.tsx`, add the project color to the status bar:

```typescript
import { getProjectColor } from '../../lib/projectColors';
```

Get the active project's color and apply as a subtle left border or text color for the project name:
```typescript
const projectColor = activeProject
  ? getProjectColor(activeProject.sortOrder, activeProject.color || null)
  : undefined;
```

Apply to the project name span:
```tsx
{activeProject && (
  <span style={{ color: projectColor || 'var(--text-primary)' }}>{activeProject.name}</span>
)}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/App.tsx frontend/src/components/layout/StatusBar.tsx
git commit -m "feat: layout auto-save every 60s, startup layout restore, project color in status bar"
```

---

## Task 17: Wails Bindings Regeneration & Smoke Test

**Files:**
- No new files — this is an integration verification task

- [ ] **Step 1: Regenerate Wails bindings**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && wails generate module`

This regenerates the TypeScript bindings in `frontend/wailsjs/` to match the new Go methods (`UpdateProject`, `SaveLayout`, `GetLayout`, `GetAllLayouts`, `ListProjectFiles`).

- [ ] **Step 2: Run all Go tests**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 3: Build the full application**

Run: `cd /home/kkjorsvik/Projects/quarterdeck && wails build`
Expected: Build succeeds

- [ ] **Step 4: Commit generated bindings if changed**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/wailsjs/
git commit -m "chore: regenerate wails bindings for new backend methods"
```

---

## Task 18: Drag-to-Reorder Projects

**Files:**
- Modify: `frontend/src/components/sidebar/ProjectEntry.tsx`
- Modify: `frontend/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Add drag handlers to ProjectEntry**

In `ProjectEntry.tsx`, add drag props to the outer div:

```typescript
// Add to ProjectEntryProps:
onDragStart: (e: React.DragEvent) => void;
onDragOver: (e: React.DragEvent) => void;
onDrop: (e: React.DragEvent) => void;
```

Add to the entry div:
```tsx
draggable
onDragStart={onDragStart}
onDragOver={onDragOver}
onDrop={onDrop}
```

- [ ] **Step 2: Implement drag logic in Sidebar**

In `Sidebar.tsx`, add drag state and handlers:

```typescript
const [draggedId, setDraggedId] = useState<number | null>(null);

const handleDragStart = (projectId: number) => (e: React.DragEvent) => {
  setDraggedId(projectId);
  e.dataTransfer.effectAllowed = 'move';
};

const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

const handleDrop = (targetId: number) => async (e: React.DragEvent) => {
  e.preventDefault();
  if (draggedId === null || draggedId === targetId) return;

  const projectsCopy = [...projects];
  const dragIdx = projectsCopy.findIndex(p => p.id === draggedId);
  const dropIdx = projectsCopy.findIndex(p => p.id === targetId);
  const [dragged] = projectsCopy.splice(dragIdx, 1);
  projectsCopy.splice(dropIdx, 0, dragged);

  // Update sort_order for all projects
  for (let i = 0; i < projectsCopy.length; i++) {
    if (projectsCopy[i].sortOrder !== i) {
      await updateProject(projectsCopy[i].id, { sortOrder: i });
    }
  }

  setDraggedId(null);
  await loadProjects();
};
```

Pass drag handlers to each `ProjectEntry`.

- [ ] **Step 3: Verify the app builds**

Run: `cd /home/kkjorsvik/Projects/quarterdeck/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/kkjorsvik/Projects/quarterdeck
git add frontend/src/components/sidebar/ProjectEntry.tsx frontend/src/components/sidebar/Sidebar.tsx
git commit -m "feat: drag-to-reorder projects in sidebar"
```

---

## Summary

18 tasks, ordered by dependency. Key dependency: Task 15 (terminal detach/reattach) must be complete before Task 9 (switchProject) can work correctly. The task ordering as written handles this — Task 8 adds WS registration to the terminal store, Task 5 creates the background terminal store, and Task 15 adds the detach mechanism. Task 9's `switchProject` uses all three.

**Critical path:** Tasks 1→2→3→4→5→8→15→9 (everything else can follow in any order after 9)

1. **SQLite migration + idempotent runner + project Update** (backend foundation)
2. **Layout persistence service** (backend)
3. **Frontend utilities** (ring buffer, fuzzy match, colors)
4. **Frontend types** (TypeScript interfaces)
5. **Overlay + background terminal stores** (new Zustand stores)
6. **Layout store setRoot** (save/restore support)
7. **Editor store replaceAll** (save/restore support)
8. **Terminal store projectId + WS registration** (project tracking + detach support)
9. **Project store switchProject** (orchestration — depends on 5, 6, 7, 8, 15)
10. **Add Project modal** (UI)
11. **Context menu + ProjectEntry** (sidebar upgrade — depends on 8)
12. **Project switcher overlay** (Ctrl+Shift+P)
13. **File search overlay** (Ctrl+P — includes TDD for ListFiles)
14. **Project settings panel** (settings tab)
15. **Terminal reattach + exit handling** (terminal continuity — must be before 9)
16. **Auto-save + startup integration** (persistence)
17. **Wails bindings + smoke test** (integration)
18. **Drag-to-reorder** (polish)
