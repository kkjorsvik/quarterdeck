package db

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenAndMigrate(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	var count int
	err = store.DB.QueryRow("SELECT COUNT(*) FROM projects").Scan(&count)
	if err != nil {
		t.Fatalf("projects table not created: %v", err)
	}

	var value string
	err = store.DB.QueryRow("SELECT value FROM settings WHERE key = 'theme'").Scan(&value)
	if err != nil {
		t.Fatalf("settings not populated: %v", err)
	}
	if value != "dark" {
		t.Errorf("expected theme 'dark', got %q", value)
	}
}

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

func TestOpenCreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "sub", "dir", "test.db")

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("database file was not created")
	}
}
