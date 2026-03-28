package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStashPushAndList(t *testing.T) {
	dir := initTestRepo(t)

	// Modify a file to have something to stash
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("modified for stash"), 0644)

	err := StashPush(dir, "test stash")
	if err != nil {
		t.Fatal(err)
	}

	entries, err := StashList(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(entries) != 1 {
		t.Fatalf("expected 1 stash entry, got %d", len(entries))
	}

	if entries[0].Index != 0 {
		t.Errorf("expected index 0, got %d", entries[0].Index)
	}

	// Verify file is restored to original
	content, _ := os.ReadFile(filepath.Join(dir, "file1.txt"))
	if string(content) != "hello" {
		t.Errorf("expected file restored to 'hello', got %q", string(content))
	}
}

func TestStashPop(t *testing.T) {
	dir := initTestRepo(t)

	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("stashed content"), 0644)
	StashPush(dir, "pop test")

	err := StashPop(dir, 0)
	if err != nil {
		t.Fatal(err)
	}

	// File should have stashed content back
	content, _ := os.ReadFile(filepath.Join(dir, "file1.txt"))
	if string(content) != "stashed content" {
		t.Errorf("expected 'stashed content', got %q", string(content))
	}

	// Stash should be empty
	entries, _ := StashList(dir)
	if len(entries) != 0 {
		t.Errorf("expected 0 stash entries after pop, got %d", len(entries))
	}
}

func TestStashDrop(t *testing.T) {
	dir := initTestRepo(t)

	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("drop content"), 0644)
	StashPush(dir, "drop test")

	err := StashDrop(dir, 0)
	if err != nil {
		t.Fatal(err)
	}

	entries, _ := StashList(dir)
	if len(entries) != 0 {
		t.Errorf("expected 0 stash entries after drop, got %d", len(entries))
	}
}

func TestStashListEmpty(t *testing.T) {
	dir := initTestRepo(t)

	entries, err := StashList(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(entries) != 0 {
		t.Errorf("expected 0 stash entries, got %d", len(entries))
	}
}
