package git

import (
	"fmt"
	"os/exec"
	"strings"
)

// HasConflicts returns true if the repo has unmerged files.
func HasConflicts(repoPath string) (bool, error) {
	files, err := ListConflictFiles(repoPath)
	if err != nil {
		return false, err
	}
	return len(files) > 0, nil
}

// ListConflictFiles returns files with unmerged status.
func ListConflictFiles(repoPath string) ([]string, error) {
	cmd := exec.Command("git", "diff", "--name-only", "--diff-filter=U")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --name-only --diff-filter=U: %w", err)
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			files = append(files, line)
		}
	}
	return files, nil
}

// MarkFileResolved stages a file to mark it as resolved.
func MarkFileResolved(repoPath, filePath string) error {
	cmd := exec.Command("git", "add", filePath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add %s: %s: %w", filePath, string(out), err)
	}
	return nil
}

// CompleteMerge completes a merge by committing with --no-edit.
func CompleteMerge(repoPath string) error {
	cmd := exec.Command("git", "commit", "--no-edit")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git commit --no-edit: %s: %w", string(out), err)
	}
	return nil
}

// AbortMerge aborts an in-progress merge.
func AbortMerge(repoPath string) error {
	cmd := exec.Command("git", "merge", "--abort")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git merge --abort: %s: %w", string(out), err)
	}
	return nil
}
