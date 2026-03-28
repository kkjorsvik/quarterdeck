package agent

import (
	"path/filepath"
	"testing"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

func setupTestStore(t *testing.T) *db.Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := db.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func insertTestRun(t *testing.T, store *db.Store, projectID int64, agentType, agentID, status string) int64 {
	t.Helper()
	res, err := store.DB.Exec(
		`INSERT INTO agent_runs (project_id, agent_type, task_description, base_commit, end_commit, status, agent_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		projectID, agentType, "test task", "abc123", "def456", status, agentID,
	)
	if err != nil {
		t.Fatalf("insert test run: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func insertTestFileChange(t *testing.T, store *db.Store, runID int64, path, changeType string, additions, deletions int) {
	t.Helper()
	_, err := store.DB.Exec(
		`INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (?, ?, ?, ?, ?)`,
		runID, path, changeType, additions, deletions,
	)
	if err != nil {
		t.Fatalf("insert test file change: %v", err)
	}
}

func TestListProjectRuns(t *testing.T) {
	store := setupTestStore(t)

	// Need a project row for FK
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", 1, "test", "/tmp/test")

	runID := insertTestRun(t, store, 1, "claude_code", "agent-1", "done")
	insertTestFileChange(t, store, runID, "main.go", "M", 10, 3)
	insertTestFileChange(t, store, runID, "new.go", "A", 50, 0)

	// Second run, different project — should not appear
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", 2, "other", "/tmp/other")
	insertTestRun(t, store, 2, "codex", "agent-2", "done")

	svc := NewRunService(store)
	runs, err := svc.ListProjectRuns(1)
	if err != nil {
		t.Fatal(err)
	}

	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}

	r := runs[0]
	if r.FileCount != 2 {
		t.Errorf("expected file_count=2, got %d", r.FileCount)
	}
	if r.TotalAdditions != 60 {
		t.Errorf("expected total_additions=60, got %d", r.TotalAdditions)
	}
	if r.TotalDeletions != 3 {
		t.Errorf("expected total_deletions=3, got %d", r.TotalDeletions)
	}
}

func TestGetRunFileChanges(t *testing.T) {
	store := setupTestStore(t)
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", 1, "test", "/tmp/test")

	runID := insertTestRun(t, store, 1, "claude_code", "agent-1", "done")
	insertTestFileChange(t, store, runID, "main.go", "M", 10, 3)
	insertTestFileChange(t, store, runID, "new.go", "A", 50, 0)
	insertTestFileChange(t, store, runID, "old.go", "D", 0, 20)

	svc := NewRunService(store)
	changes, err := svc.GetRunFileChanges(runID)
	if err != nil {
		t.Fatal(err)
	}

	if len(changes) != 3 {
		t.Fatalf("expected 3 changes, got %d", len(changes))
	}

	// Should be ordered by change_type, file_path: A(new.go), D(old.go), M(main.go)
	if changes[0].ChangeType != "A" || changes[0].FilePath != "new.go" {
		t.Errorf("first change: got %s %s", changes[0].ChangeType, changes[0].FilePath)
	}
	if changes[1].ChangeType != "D" || changes[1].FilePath != "old.go" {
		t.Errorf("second change: got %s %s", changes[1].ChangeType, changes[1].FilePath)
	}
	if changes[2].ChangeType != "M" || changes[2].FilePath != "main.go" {
		t.Errorf("third change: got %s %s", changes[2].ChangeType, changes[2].FilePath)
	}
}

func TestGetRunByAgentID(t *testing.T) {
	store := setupTestStore(t)
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", 1, "test", "/tmp/test")

	runID := insertTestRun(t, store, 1, "claude_code", "agent-abc", "done")
	insertTestFileChange(t, store, runID, "file.go", "M", 5, 2)

	svc := NewRunService(store)
	r, err := svc.GetRunByAgentID("agent-abc")
	if err != nil {
		t.Fatal(err)
	}

	if r.AgentID != "agent-abc" {
		t.Errorf("expected agent_id='agent-abc', got %q", r.AgentID)
	}
	if r.FileCount != 1 {
		t.Errorf("expected file_count=1, got %d", r.FileCount)
	}
	if r.TotalAdditions != 5 {
		t.Errorf("expected total_additions=5, got %d", r.TotalAdditions)
	}
}

func TestGetRunByAgentIDNotFound(t *testing.T) {
	store := setupTestStore(t)
	svc := NewRunService(store)

	_, err := svc.GetRunByAgentID("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent agent ID")
	}
}
