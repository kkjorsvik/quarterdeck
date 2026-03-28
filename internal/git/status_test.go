package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetStatus(t *testing.T) {
	dir := initTestRepo(t)

	// Modify existing file (unstaged)
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed"), 0644)

	// Add untracked file
	os.WriteFile(filepath.Join(dir, "newfile.txt"), []byte("new"), 0644)

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	got := map[string]FileStatus{}
	for _, s := range statuses {
		got[s.Path+"|"+boolStr(s.IsStaged)] = s
	}

	// file1.txt should be modified, unstaged
	if s, ok := got["file1.txt|false"]; !ok {
		t.Errorf("expected unstaged modified file1.txt, got statuses: %+v", statuses)
	} else if s.Status != "modified" {
		t.Errorf("file1.txt status: want modified, got %q", s.Status)
	}

	// newfile.txt should be untracked
	if s, ok := got["newfile.txt|false"]; !ok {
		t.Errorf("expected untracked newfile.txt, got statuses: %+v", statuses)
	} else if s.Status != "untracked" {
		t.Errorf("newfile.txt status: want untracked, got %q", s.Status)
	}
}

func TestGetStatusStaged(t *testing.T) {
	dir := initTestRepo(t)

	// Modify and stage
	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("changed"), 0644)
	gitCmd(t, dir, "add", "file1.txt")

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, s := range statuses {
		if s.Path == "file1.txt" && s.IsStaged && s.Status == "modified" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected staged modified file1.txt, got: %+v", statuses)
	}
}

func TestGetStatusClean(t *testing.T) {
	dir := initTestRepo(t)

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(statuses) != 0 {
		t.Errorf("expected empty status for clean repo, got: %+v", statuses)
	}
}

func TestGetStatusDeleted(t *testing.T) {
	dir := initTestRepo(t)

	os.Remove(filepath.Join(dir, "file1.txt"))

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, s := range statuses {
		if s.Path == "file1.txt" && s.Status == "deleted" && !s.IsStaged {
			found = true
		}
	}
	if !found {
		t.Errorf("expected unstaged deleted file1.txt, got: %+v", statuses)
	}
}

func TestGetStatusRenamed(t *testing.T) {
	dir := initTestRepo(t)

	gitCmd(t, dir, "mv", "file1.txt", "renamed.txt")

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, s := range statuses {
		if s.Path == "renamed.txt" && s.Status == "renamed" && s.IsStaged {
			found = true
		}
	}
	if !found {
		t.Errorf("expected staged renamed renamed.txt, got: %+v", statuses)
	}
}

func TestGetStatusAdded(t *testing.T) {
	dir := initTestRepo(t)

	os.WriteFile(filepath.Join(dir, "new.txt"), []byte("new"), 0644)
	gitCmd(t, dir, "add", "new.txt")

	statuses, err := GetStatus(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, s := range statuses {
		if s.Path == "new.txt" && s.Status == "staged" && s.IsStaged {
			found = true
		}
	}
	if !found {
		t.Errorf("expected staged new.txt, got: %+v", statuses)
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
