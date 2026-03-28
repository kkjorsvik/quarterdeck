package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// currentBranch returns the current branch name in the repo.
func currentBranch(t *testing.T, dir string) string {
	t.Helper()
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("get current branch: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func TestListBranches(t *testing.T) {
	dir := initTestRepo(t)

	branches, err := ListBranches(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(branches) == 0 {
		t.Fatal("expected at least one branch")
	}

	found := false
	for _, b := range branches {
		if b.IsCurrent {
			found = true
			if len(b.CommitSHA) < 7 {
				t.Errorf("expected abbreviated SHA, got %q", b.CommitSHA)
			}
		}
	}
	if !found {
		t.Error("no current branch found")
	}
}

func TestCreateBranch(t *testing.T) {
	dir := initTestRepo(t)

	err := CreateBranch(dir, "new-feature", "")
	if err != nil {
		t.Fatal(err)
	}

	branches, err := ListBranches(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, b := range branches {
		if b.Name == "new-feature" {
			found = true
		}
	}
	if !found {
		t.Error("new-feature branch not found after creation")
	}
}

func TestSwitchBranch(t *testing.T) {
	dir := initTestRepo(t)

	CreateBranch(dir, "switch-target", "")
	err := SwitchBranch(dir, "switch-target")
	if err != nil {
		t.Fatal(err)
	}

	branches, err := ListBranches(dir)
	if err != nil {
		t.Fatal(err)
	}

	for _, b := range branches {
		if b.Name == "switch-target" && !b.IsCurrent {
			t.Error("switch-target should be current after switch")
		}
	}
}

func TestDeleteBranch(t *testing.T) {
	dir := initTestRepo(t)

	CreateBranch(dir, "to-delete", "")
	err := DeleteBranch(dir, "to-delete", false)
	if err != nil {
		t.Fatal(err)
	}

	branches, err := ListBranches(dir)
	if err != nil {
		t.Fatal(err)
	}

	for _, b := range branches {
		if b.Name == "to-delete" {
			t.Error("to-delete branch should not exist after deletion")
		}
	}
}

func TestMergeBranchSuccess(t *testing.T) {
	dir := initTestRepo(t)
	mainBranch := currentBranch(t, dir)

	// Create feature branch and add a commit
	gitCmd(t, dir, "checkout", "-b", "feature")
	os.WriteFile(filepath.Join(dir, "feature.txt"), []byte("feature"), 0644)
	gitCmd(t, dir, "add", "feature.txt")
	gitCmd(t, dir, "commit", "-m", "feature commit")

	// Switch back to main branch
	gitCmd(t, dir, "checkout", mainBranch)

	result, err := MergeBranch(dir, "feature")
	if err != nil {
		t.Fatal(err)
	}

	if !result.Success {
		t.Errorf("expected successful merge, got: %+v", result)
	}
	if result.HasConflict {
		t.Error("expected no conflict")
	}
}

func TestMergeBranchConflict(t *testing.T) {
	dir := initTestRepo(t)
	mainBranch := currentBranch(t, dir)

	// Create conflicting changes on two branches
	gitCmd(t, dir, "checkout", "-b", "feature")
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("feature content"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "feature change")

	gitCmd(t, dir, "checkout", mainBranch)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("master content"), 0644)
	gitCmd(t, dir, "add", "file1.txt")
	gitCmd(t, dir, "commit", "-m", "master change")

	result, err := MergeBranch(dir, "feature")
	if err != nil {
		t.Fatal(err)
	}

	if result.Success {
		t.Error("expected merge failure due to conflict")
	}
	if !result.HasConflict {
		t.Error("expected HasConflict to be true")
	}
	if len(result.ConflictFiles) == 0 {
		t.Error("expected at least one conflict file")
	}

	// Clean up: abort merge
	gitCmd(t, dir, "merge", "--abort")
}

func TestGetAheadBehind(t *testing.T) {
	dir := initTestRepo(t)
	mainBranch := currentBranch(t, dir)

	// Create a branch with an extra commit
	gitCmd(t, dir, "checkout", "-b", "feature")
	os.WriteFile(filepath.Join(dir, "feature.txt"), []byte("feature"), 0644)
	gitCmd(t, dir, "add", "feature.txt")
	gitCmd(t, dir, "commit", "-m", "feature commit")

	ahead, behind, err := GetAheadBehind(dir, "feature", mainBranch)
	if err != nil {
		t.Fatal(err)
	}

	if ahead != 1 {
		t.Errorf("expected 1 ahead, got %d", ahead)
	}
	if behind != 0 {
		t.Errorf("expected 0 behind, got %d", behind)
	}
}
