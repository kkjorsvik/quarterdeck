package git

import (
	"fmt"
	"os/exec"
	"strings"
)

// FileStatus represents the status of a single file in the working tree.
type FileStatus struct {
	Path     string `json:"path"`
	Status   string `json:"status"`   // "modified", "staged", "untracked", "deleted", "renamed", "conflicted"
	IsStaged bool   `json:"isStaged"`
}

// GetStatus returns the status of all files in the working tree using git status --porcelain=v1.
func GetStatus(repoPath string) ([]FileStatus, error) {
	cmd := exec.Command("git", "status", "--porcelain=v1")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status --porcelain=v1: %w", err)
	}
	return parsePorcelainV1(string(out)), nil
}

// parsePorcelainV1 parses git status --porcelain=v1 output into FileStatus entries.
// Format: XY PATH or XY ORIG -> PATH (for renames)
func parsePorcelainV1(output string) []FileStatus {
	var statuses []FileStatus
	for _, line := range strings.Split(output, "\n") {
		if len(line) < 4 {
			continue
		}
		x := line[0] // index (staged) status
		y := line[1] // worktree status
		path := line[3:]

		// Handle renames: "R  old -> new"
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}

		// Conflict markers
		if isConflict(x, y) {
			statuses = append(statuses, FileStatus{
				Path:     path,
				Status:   "conflicted",
				IsStaged: false,
			})
			continue
		}

		// Untracked
		if x == '?' && y == '?' {
			statuses = append(statuses, FileStatus{
				Path:     path,
				Status:   "untracked",
				IsStaged: false,
			})
			continue
		}

		// Process index (staged) status
		if x != ' ' && x != '?' {
			status := indexStatus(x)
			statuses = append(statuses, FileStatus{
				Path:     path,
				Status:   status,
				IsStaged: true,
			})
		}

		// Process worktree (unstaged) status
		if y != ' ' && y != '?' {
			status := worktreeStatus(y)
			statuses = append(statuses, FileStatus{
				Path:     path,
				Status:   status,
				IsStaged: false,
			})
		}
	}
	return statuses
}

func isConflict(x, y byte) bool {
	// UU, AA, DD, AU, UA, DU, UD
	if x == 'U' || y == 'U' {
		return true
	}
	if x == 'A' && y == 'A' {
		return true
	}
	if x == 'D' && y == 'D' {
		return true
	}
	return false
}

func indexStatus(x byte) string {
	switch x {
	case 'M':
		return "modified"
	case 'A':
		return "staged"
	case 'D':
		return "deleted"
	case 'R':
		return "renamed"
	default:
		return "modified"
	}
}

func worktreeStatus(y byte) string {
	switch y {
	case 'M':
		return "modified"
	case 'D':
		return "deleted"
	default:
		return "modified"
	}
}
