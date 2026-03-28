package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetLog(t *testing.T) {
	dir := initTestRepo(t)

	commits, err := GetLog(dir, 10, 0)
	if err != nil {
		t.Fatal(err)
	}

	if len(commits) != 1 {
		t.Fatalf("expected 1 commit, got %d", len(commits))
	}

	c := commits[0]
	if len(c.SHA) != 40 {
		t.Errorf("expected 40-char SHA, got %q", c.SHA)
	}
	if c.Message != "initial" {
		t.Errorf("expected message 'initial', got %q", c.Message)
	}
	if c.Author != "Test" {
		t.Errorf("expected author 'Test', got %q", c.Author)
	}
	if c.Date == "" {
		t.Error("expected non-empty date")
	}
}

func TestGetLogLimitOffset(t *testing.T) {
	dir := initTestRepo(t)

	// Add more commits
	for i := 0; i < 5; i++ {
		os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("v"+string(rune('0'+i))), 0644)
		gitCmd(t, dir, "add", ".")
		gitCmd(t, dir, "commit", "-m", "commit "+string(rune('0'+i)))
	}

	// Total: 6 commits (initial + 5)
	all, _ := GetLog(dir, 0, 0)
	if len(all) != 6 {
		t.Fatalf("expected 6 commits, got %d", len(all))
	}

	// Limit to 2
	limited, _ := GetLog(dir, 2, 0)
	if len(limited) != 2 {
		t.Fatalf("expected 2 commits with limit, got %d", len(limited))
	}

	// Skip 4, get 2
	offset, _ := GetLog(dir, 2, 4)
	if len(offset) != 2 {
		t.Fatalf("expected 2 commits with offset, got %d", len(offset))
	}
}

func TestGetCommitFileChanges(t *testing.T) {
	dir := initTestRepo(t)

	os.WriteFile(filepath.Join(dir, "file2.txt"), []byte("new"), 0644)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed"), 0644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "add and modify")

	sha, _ := HeadCommit(dir)
	changes, err := GetCommitFileChanges(dir, sha)
	if err != nil {
		t.Fatal(err)
	}

	got := map[string]string{}
	for _, c := range changes {
		got[c.Path] = c.ChangeType
	}

	if got["file2.txt"] != "A" {
		t.Errorf("file2.txt: want A, got %q", got["file2.txt"])
	}
	if got["file1.txt"] != "M" {
		t.Errorf("file1.txt: want M, got %q", got["file1.txt"])
	}
}

func TestGetCommitFileDiff(t *testing.T) {
	dir := initTestRepo(t)

	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("modified"), 0644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "modify file1")

	sha, _ := HeadCommit(dir)
	diff, err := GetCommitFileDiff(dir, sha, "file1.txt")
	if err != nil {
		t.Fatal(err)
	}

	if diff.Original != "hello" {
		t.Errorf("expected original 'hello', got %q", diff.Original)
	}
	if diff.Modified != "modified" {
		t.Errorf("expected modified 'modified', got %q", diff.Modified)
	}
	if diff.ChangeType != "M" {
		t.Errorf("expected change type M, got %q", diff.ChangeType)
	}
}
