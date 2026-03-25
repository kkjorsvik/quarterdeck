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

// createProject inserts a project row so foreign key constraints are satisfied.
func createProject(t *testing.T, store *db.Store, id int64) {
	t.Helper()
	_, err := store.DB.Exec(
		"INSERT INTO projects (id, name, path) VALUES (?, ?, ?)",
		id, "test-project", "/tmp/test-project",
	)
	if err != nil {
		t.Fatalf("create project %d: %v", id, err)
	}
}

func TestSaveAndGetLayout(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)
	createProject(t, store, 1)

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
	createProject(t, store, 1)

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
	createProject(t, store, 1)

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
	createProject(t, store, 1)
	_, _ = store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", 2, "proj2", "/tmp/proj2")

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
