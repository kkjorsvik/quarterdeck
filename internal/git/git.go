package git

import (
	"fmt"
	"os/exec"
	"strings"
)

// FileChange represents a single file change in a diff.
type FileChange struct {
	Path       string
	ChangeType string // "A", "M", "D"
}

// HeadCommit returns the SHA of HEAD in the given repo.
func HeadCommit(repoPath string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// DiffFileList returns the list of changed files between two refs.
func DiffFileList(repoPath, fromRef, toRef string) ([]FileChange, error) {
	cmd := exec.Command("git", "diff", "--name-status", fromRef, toRef)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --name-status: %w", err)
	}
	return parseNameStatus(string(out)), nil
}

// DiffWorkingTree returns uncommitted changes (staged + unstaged + untracked).
func DiffWorkingTree(repoPath string) ([]FileChange, error) {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status --porcelain: %w", err)
	}
	return parsePorcelain(string(out)), nil
}

// parseNameStatus parses output of git diff --name-status.
// Lines look like: "M\tfile.txt", "A\tnew.txt", "R100\told\tnew", "C100\tsrc\tdst"
func parseNameStatus(output string) []FileChange {
	var changes []FileChange
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		status := parts[0]
		switch {
		case strings.HasPrefix(status, "R"):
			// Rename: use new path, treat as Add
			if len(parts) >= 3 {
				changes = append(changes, FileChange{Path: parts[2], ChangeType: "A"})
			}
		case strings.HasPrefix(status, "C"):
			// Copy: use destination path, treat as Add
			if len(parts) >= 3 {
				changes = append(changes, FileChange{Path: parts[2], ChangeType: "A"})
			}
		default:
			changes = append(changes, FileChange{Path: parts[1], ChangeType: status})
		}
	}
	return changes
}

// ShowFile returns the content of a file at a given commit ref.
func ShowFile(repoPath, commitRef, filePath string) (string, error) {
	cmd := exec.Command("git", "show", commitRef+":"+filePath)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git show %s:%s: %w", commitRef, filePath, err)
	}
	return string(out), nil
}

// DiffNumstat returns per-file addition/deletion counts between two refs.
func DiffNumstat(repoPath, fromRef, toRef string) (map[string][2]int, error) {
	cmd := exec.Command("git", "diff", "--numstat", fromRef, toRef)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --numstat: %w", err)
	}
	return parseNumstat(string(out)), nil
}

// DiffNumstatWorkingTree returns per-file addition/deletion counts for uncommitted changes.
func DiffNumstatWorkingTree(repoPath string) (map[string][2]int, error) {
	cmd := exec.Command("git", "diff", "--numstat", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --numstat HEAD: %w", err)
	}
	return parseNumstat(string(out)), nil
}

func parseNumstat(output string) map[string][2]int {
	result := make(map[string][2]int)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		if parts[0] == "-" || parts[1] == "-" {
			result[parts[len(parts)-1]] = [2]int{0, 0}
			continue
		}
		var add, del int
		fmt.Sscanf(parts[0], "%d", &add)
		fmt.Sscanf(parts[1], "%d", &del)
		result[parts[len(parts)-1]] = [2]int{add, del}
	}
	return result
}

// parsePorcelain parses output of git status --porcelain.
// Lines look like: "?? newfile.txt", " M modified.txt", "A  staged.txt", "D  deleted.txt"
func parsePorcelain(output string) []FileChange {
	var changes []FileChange
	for _, line := range strings.Split(output, "\n") {
		if len(line) < 4 {
			continue
		}
		x := line[0] // index (staged) status
		y := line[1] // worktree status
		path := line[3:]

		// Handle renames with " -> "
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}

		ct := ""
		switch {
		case x == '?' || y == '?':
			ct = "A"
		case x == 'A' || y == 'A':
			ct = "A"
		case x == 'D' || y == 'D':
			ct = "D"
		case x == 'M' || y == 'M':
			ct = "M"
		case x == 'R' || y == 'R':
			ct = "A"
		default:
			ct = "M"
		}
		changes = append(changes, FileChange{Path: path, ChangeType: ct})
	}
	return changes
}
