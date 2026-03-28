package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// initTestRepo creates a temp dir with a git repo containing one committed file.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	env := []string{
		"GIT_AUTHOR_NAME=Test",
		"GIT_AUTHOR_EMAIL=test@test.com",
		"GIT_COMMITTER_NAME=Test",
		"GIT_COMMITTER_EMAIL=test@test.com",
	}

	cmds := [][]string{
		{"git", "init"},
		{"git", "config", "user.name", "Test"},
		{"git", "config", "user.email", "test@test.com"},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), env...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("setup %v: %s %v", args, out, err)
		}
	}

	// Create and commit file1.txt
	if err := os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"git", "add", "file1.txt"},
		{"git", "commit", "-m", "initial"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), env...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("setup %v: %s %v", args, out, err)
		}
	}

	return dir
}

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	env := []string{
		"GIT_AUTHOR_NAME=Test",
		"GIT_AUTHOR_EMAIL=test@test.com",
		"GIT_COMMITTER_NAME=Test",
		"GIT_COMMITTER_EMAIL=test@test.com",
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s %v", args, out, err)
	}
}

func TestHeadCommit(t *testing.T) {
	dir := initTestRepo(t)
	sha, err := HeadCommit(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(sha) != 40 {
		t.Fatalf("expected 40-char SHA, got %q (len %d)", sha, len(sha))
	}
}

func TestHeadCommitNotARepo(t *testing.T) {
	dir := t.TempDir() // not a git repo
	_, err := HeadCommit(dir)
	if err == nil {
		t.Fatal("expected error for non-repo dir")
	}
}

func TestDiffFileList(t *testing.T) {
	dir := initTestRepo(t)
	base, _ := HeadCommit(dir)

	// Add a new file and modify existing
	os.WriteFile(filepath.Join(dir, "file2.txt"), []byte("new"), 0644)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("modified"), 0644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "second")

	head, _ := HeadCommit(dir)
	changes, err := DiffFileList(dir, base, head)
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

func TestDiffFileListWithDelete(t *testing.T) {
	dir := initTestRepo(t)
	base, _ := HeadCommit(dir)

	os.Remove(filepath.Join(dir, "file1.txt"))
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "delete file1")

	head, _ := HeadCommit(dir)
	changes, err := DiffFileList(dir, base, head)
	if err != nil {
		t.Fatal(err)
	}

	if len(changes) != 1 || changes[0].ChangeType != "D" || changes[0].Path != "file1.txt" {
		t.Fatalf("expected [{file1.txt D}], got %+v", changes)
	}
}

func TestDiffWorkingTree(t *testing.T) {
	dir := initTestRepo(t)

	// Modify file1.txt without committing
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed"), 0644)

	changes, err := DiffWorkingTree(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(changes) == 0 {
		t.Fatal("expected at least one change")
	}
	found := false
	for _, c := range changes {
		if c.Path == "file1.txt" && c.ChangeType == "M" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected modified file1.txt, got %+v", changes)
	}
}
