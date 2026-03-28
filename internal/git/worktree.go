package git

import (
	"fmt"
	"os/exec"
	"strings"
)

// Worktree represents a git worktree entry.
type Worktree struct {
	Path      string `json:"path"`
	Branch    string `json:"branch"`
	IsMain    bool   `json:"isMain"`
	CommitSHA string `json:"commitSha"`
}

// ListWorktrees returns all worktrees for the given repo using git worktree list --porcelain.
func ListWorktrees(repoPath string) ([]Worktree, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git worktree list: %w", err)
	}
	return parsePorcelainWorktrees(string(out)), nil
}

// CreateWorktree creates a new worktree with a new branch.
func CreateWorktree(repoPath, path, branch string) error {
	cmd := exec.Command("git", "worktree", "add", "-b", branch, path)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree add -b %s %s: %s: %w", branch, path, string(out), err)
	}
	return nil
}

// CreateWorktreeFromExisting creates a new worktree from an existing branch.
func CreateWorktreeFromExisting(repoPath, path, branch string) error {
	cmd := exec.Command("git", "worktree", "add", path, branch)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree add %s %s: %s: %w", path, branch, string(out), err)
	}
	return nil
}

// RemoveWorktree removes a worktree at the given path.
func RemoveWorktree(repoPath, path string, force bool) error {
	args := []string{"worktree", "remove", path}
	if force {
		args = []string{"worktree", "remove", "--force", path}
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree remove %s: %s: %w", path, string(out), err)
	}
	return nil
}

// parsePorcelainWorktrees parses git worktree list --porcelain output.
// Format:
//
//	worktree /path/to/worktree
//	HEAD <sha>
//	branch refs/heads/<name>
//	<blank line>
func parsePorcelainWorktrees(output string) []Worktree {
	var worktrees []Worktree
	var current Worktree
	isFirst := true

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)

		switch {
		case strings.HasPrefix(line, "worktree "):
			if !isFirst && current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = Worktree{Path: strings.TrimPrefix(line, "worktree ")}
			isFirst = false

		case strings.HasPrefix(line, "HEAD "):
			current.CommitSHA = strings.TrimPrefix(line, "HEAD ")

		case strings.HasPrefix(line, "branch "):
			ref := strings.TrimPrefix(line, "branch ")
			current.Branch = strings.TrimPrefix(ref, "refs/heads/")

		case line == "bare":
			current.IsMain = true
		}
	}

	// Append the last entry
	if current.Path != "" {
		worktrees = append(worktrees, current)
	}

	// Mark the first worktree as main (the original checkout)
	if len(worktrees) > 0 && !worktrees[0].IsMain {
		worktrees[0].IsMain = true
	}

	return worktrees
}
