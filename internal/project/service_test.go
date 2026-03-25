package project

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

func TestAddAndListProjects(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	p, err := svc.Add("myproject", "/home/user/myproject")
	if err != nil {
		t.Fatalf("Add failed: %v", err)
	}
	if p.Name != "myproject" {
		t.Errorf("expected name 'myproject', got %q", p.Name)
	}
	if p.ID == 0 {
		t.Error("expected non-zero ID")
	}

	projects, err := svc.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(projects))
	}
	if projects[0].Path != "/home/user/myproject" {
		t.Errorf("expected path '/home/user/myproject', got %q", projects[0].Path)
	}
}

func TestAddDuplicatePathFails(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	_, err := svc.Add("first", "/home/user/project")
	if err != nil {
		t.Fatalf("first Add failed: %v", err)
	}

	_, err = svc.Add("second", "/home/user/project")
	if err == nil {
		t.Error("expected error for duplicate path, got nil")
	}
}

func TestGetProject(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	added, _ := svc.Add("test", "/tmp/test")
	got, err := svc.Get(added.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Name != "test" {
		t.Errorf("expected 'test', got %q", got.Name)
	}
}

func TestDeleteProject(t *testing.T) {
	store := setupTestDB(t)
	svc := NewService(store)

	p, _ := svc.Add("todelete", "/tmp/todelete")
	err := svc.Delete(p.ID)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	projects, _ := svc.List()
	if len(projects) != 0 {
		t.Errorf("expected 0 projects after delete, got %d", len(projects))
	}
}
