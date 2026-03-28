package git

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// Branch represents a git branch with metadata.
type Branch struct {
	Name        string `json:"name"`
	CommitSHA   string `json:"commitSha"`
	CommitMsg   string `json:"commitMsg"`
	IsCurrent   bool   `json:"isCurrent"`
	IsWorktree  bool   `json:"isWorktree"`
	AheadBehind string `json:"aheadBehind"`
}

// MergeResult represents the outcome of a merge operation.
type MergeResult struct {
	Success       bool     `json:"success"`
	HasConflict   bool     `json:"hasConflict"`
	Message       string   `json:"message"`
	ConflictFiles []string `json:"conflictFiles"`
}

// ListBranches returns all local branches with metadata.
func ListBranches(repoPath string) ([]Branch, error) {
	cmd := exec.Command("git", "branch", "-v", "--no-color")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git branch -v: %w", err)
	}

	// Get worktree branches to mark them
	wtBranches := worktreeBranches(repoPath)

	var branches []Branch
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}

		isCurrent := false
		if strings.HasPrefix(line, "* ") {
			isCurrent = true
			line = line[2:]
		} else {
			line = strings.TrimLeft(line, " ")
		}

		// Parse: <name> <sha> <message>
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		name := fields[0]
		sha := fields[1]
		msg := ""
		if len(fields) > 2 {
			msg = strings.Join(fields[2:], " ")
		}

		_, isWT := wtBranches[name]

		branches = append(branches, Branch{
			Name:       name,
			CommitSHA:  sha,
			CommitMsg:  msg,
			IsCurrent:  isCurrent,
			IsWorktree: isWT,
		})
	}

	return branches, nil
}

// worktreeBranches returns a set of branch names checked out in worktrees.
func worktreeBranches(repoPath string) map[string]bool {
	result := make(map[string]bool)
	wts, err := ListWorktrees(repoPath)
	if err != nil {
		return result
	}
	for _, wt := range wts {
		if wt.Branch != "" {
			result[wt.Branch] = true
		}
	}
	return result
}

// CreateBranch creates a new branch at the given start point.
func CreateBranch(repoPath, name, startPoint string) error {
	args := []string{"branch", name}
	if startPoint != "" {
		args = append(args, startPoint)
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git branch %s: %s: %w", name, string(out), err)
	}
	return nil
}

// SwitchBranch switches to the named branch.
func SwitchBranch(repoPath, name string) error {
	cmd := exec.Command("git", "checkout", name)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git checkout %s: %s: %w", name, string(out), err)
	}
	return nil
}

// DeleteBranch deletes a branch. If force is true, uses -D instead of -d.
func DeleteBranch(repoPath, name string, force bool) error {
	flag := "-d"
	if force {
		flag = "-D"
	}
	cmd := exec.Command("git", "branch", flag, name)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git branch %s %s: %s: %w", flag, name, string(out), err)
	}
	return nil
}

// MergeBranch merges the named branch into the current branch.
func MergeBranch(repoPath, name string) (*MergeResult, error) {
	cmd := exec.Command("git", "merge", name)
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()

	if err == nil {
		return &MergeResult{
			Success: true,
			Message: strings.TrimSpace(string(out)),
		}, nil
	}

	// Check for conflict files
	conflictFiles := listConflictFilesRaw(repoPath)
	if len(conflictFiles) > 0 {
		return &MergeResult{
			Success:       false,
			HasConflict:   true,
			Message:       strings.TrimSpace(string(out)),
			ConflictFiles: conflictFiles,
		}, nil
	}

	return nil, fmt.Errorf("git merge %s: %s: %w", name, string(out), err)
}

// listConflictFilesRaw returns files with unmerged status.
func listConflictFilesRaw(repoPath string) []string {
	cmd := exec.Command("git", "diff", "--name-only", "--diff-filter=U")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			files = append(files, line)
		}
	}
	return files
}

// GetAheadBehind returns the number of commits ahead and behind between branch and upstream.
func GetAheadBehind(repoPath, branch, upstream string) (int, int, error) {
	ref := branch + "..." + upstream
	cmd := exec.Command("git", "rev-list", "--left-right", "--count", ref)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return 0, 0, fmt.Errorf("git rev-list --left-right --count %s: %w", ref, err)
	}

	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("unexpected rev-list output: %q", string(out))
	}

	ahead, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("parse ahead count: %w", err)
	}
	behind, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("parse behind count: %w", err)
	}

	return ahead, behind, nil
}
