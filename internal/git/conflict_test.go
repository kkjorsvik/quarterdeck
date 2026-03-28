package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHasConflictsClean(t *testing.T) {
	dir := initTestRepo(t)

	has, err := HasConflicts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if has {
		t.Error("expected no conflicts in clean repo")
	}
}

func TestConflictWorkflow(t *testing.T) {
	dir := initTestRepo(t)
	mainBranch := currentBranch(t, dir)

	// Create conflicting branches
	gitCmd(t, dir, "checkout", "-b", "conflict-feature")
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("feature content"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "feature change")

	gitCmd(t, dir, "checkout", mainBranch)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("main content"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "main change")

	// Merge to create conflict
	MergeBranch(dir, "conflict-feature")

	// Should have conflicts
	has, err := HasConflicts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !has {
		t.Error("expected conflicts after merge")
	}

	// List conflict files
	files, err := ListConflictFiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Error("expected at least one conflict file")
	}

	// Resolve: write resolved content and mark resolved
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("resolved content"), 0644)
	err = MarkFileResolved(dir, "file1.txt")
	if err != nil {
		t.Fatal(err)
	}

	// After resolving, no more conflicts
	has, err = HasConflicts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if has {
		t.Error("expected no conflicts after marking resolved")
	}

	// Complete merge
	err = CompleteMerge(dir)
	if err != nil {
		t.Fatal(err)
	}
}

func TestAbortMerge(t *testing.T) {
	dir := initTestRepo(t)
	mainBranch := currentBranch(t, dir)

	// Create conflicting branches
	gitCmd(t, dir, "checkout", "-b", "abort-feature")
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("feature"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "feature")

	gitCmd(t, dir, "checkout", mainBranch)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("main"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "main")

	MergeBranch(dir, "abort-feature")

	err := AbortMerge(dir)
	if err != nil {
		t.Fatal(err)
	}

	has, _ := HasConflicts(dir)
	if has {
		t.Error("expected no conflicts after abort")
	}
}
