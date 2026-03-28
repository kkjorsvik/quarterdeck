package git

import (
	"path/filepath"
	"testing"
)

func TestListWorktrees(t *testing.T) {
	dir := initTestRepo(t)

	wts, err := ListWorktrees(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(wts) != 1 {
		t.Fatalf("expected 1 worktree, got %d: %+v", len(wts), wts)
	}

	if !wts[0].IsMain {
		t.Error("expected first worktree to be main")
	}

	if wts[0].Branch == "" {
		t.Error("expected branch name, got empty")
	}

	if len(wts[0].CommitSHA) != 40 {
		t.Errorf("expected 40-char SHA, got %q", wts[0].CommitSHA)
	}
}

func TestCreateWorktreeAndList(t *testing.T) {
	dir := initTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "feature-wt")

	err := CreateWorktree(dir, wtPath, "feature-branch")
	if err != nil {
		t.Fatal(err)
	}

	wts, err := ListWorktrees(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(wts) != 2 {
		t.Fatalf("expected 2 worktrees, got %d: %+v", len(wts), wts)
	}

	// Find the new worktree
	found := false
	for _, wt := range wts {
		if wt.Branch == "feature-branch" {
			found = true
			if wt.IsMain {
				t.Error("new worktree should not be main")
			}
		}
	}
	if !found {
		t.Errorf("did not find worktree with branch feature-branch in: %+v", wts)
	}
}

func TestCreateWorktreeFromExisting(t *testing.T) {
	dir := initTestRepo(t)

	// Create a branch first
	gitCmd(t, dir, "branch", "existing-branch")

	wtPath := filepath.Join(t.TempDir(), "existing-wt")
	err := CreateWorktreeFromExisting(dir, wtPath, "existing-branch")
	if err != nil {
		t.Fatal(err)
	}

	wts, err := ListWorktrees(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(wts) != 2 {
		t.Fatalf("expected 2 worktrees, got %d", len(wts))
	}
}

func TestRemoveWorktree(t *testing.T) {
	dir := initTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "to-remove")

	err := CreateWorktree(dir, wtPath, "remove-branch")
	if err != nil {
		t.Fatal(err)
	}

	// Verify it exists
	wts, _ := ListWorktrees(dir)
	if len(wts) != 2 {
		t.Fatalf("expected 2 worktrees before remove, got %d", len(wts))
	}

	err = RemoveWorktree(dir, wtPath, false)
	if err != nil {
		t.Fatal(err)
	}

	wts, _ = ListWorktrees(dir)
	if len(wts) != 1 {
		t.Fatalf("expected 1 worktree after remove, got %d", len(wts))
	}
}
