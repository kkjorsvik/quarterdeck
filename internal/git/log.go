package git

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// CommitInfo represents a single commit entry.
type CommitInfo struct {
	SHA      string `json:"sha"`
	Message  string `json:"message"`
	Author   string `json:"author"`
	Date     string `json:"date"`
	AgentRun *int64 `json:"agentRun"`
}

// FileDiff represents a diff for a single file at a commit.
type FileDiff struct {
	FilePath   string `json:"filePath"`
	Original   string `json:"original"`
	Modified   string `json:"modified"`
	ChangeType string `json:"changeType"`
}

// GetLog returns commit history with optional limit and offset.
func GetLog(repoPath string, limit, offset int) ([]CommitInfo, error) {
	format := "%H||%s||%an||%aI||%(trailers:key=Agent-Run,valueonly)"
	args := []string{"log", "--format=" + format}
	if limit > 0 {
		args = append(args, "-n", strconv.Itoa(limit))
	}
	if offset > 0 {
		args = append(args, "--skip", strconv.Itoa(offset))
	}

	cmd := exec.Command("git", args...)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git log: %w", err)
	}

	var commits []CommitInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "||", 5)
		if len(parts) < 4 {
			continue
		}

		ci := CommitInfo{
			SHA:     parts[0],
			Message: parts[1],
			Author:  parts[2],
			Date:    parts[3],
		}

		if len(parts) == 5 && strings.TrimSpace(parts[4]) != "" {
			val := strings.TrimSpace(parts[4])
			if id, err := strconv.ParseInt(val, 10, 64); err == nil {
				ci.AgentRun = &id
			}
		}

		commits = append(commits, ci)
	}

	return commits, nil
}

// GetCommitFileChanges returns the list of files changed in a commit.
func GetCommitFileChanges(repoPath, sha string) ([]FileChange, error) {
	cmd := exec.Command("git", "diff-tree", "--no-commit-id", "-r", "--name-status", sha)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff-tree %s: %w", sha, err)
	}
	return parseNameStatus(string(out)), nil
}

// GetCommitFileDiff returns the file content before and after a commit.
func GetCommitFileDiff(repoPath, sha, filePath string) (*FileDiff, error) {
	// Determine change type
	changes, err := GetCommitFileChanges(repoPath, sha)
	if err != nil {
		return nil, err
	}

	changeType := "M"
	for _, c := range changes {
		if c.Path == filePath {
			changeType = c.ChangeType
			break
		}
	}

	diff := &FileDiff{
		FilePath:   filePath,
		ChangeType: changeType,
	}

	// Get modified version (at the commit)
	if changeType != "D" {
		content, err := ShowFile(repoPath, sha, filePath)
		if err != nil {
			return nil, fmt.Errorf("show modified %s:%s: %w", sha, filePath, err)
		}
		diff.Modified = content
	}

	// Get original version (parent commit)
	if changeType != "A" {
		content, err := ShowFile(repoPath, sha+"^", filePath)
		if err != nil {
			return nil, fmt.Errorf("show original %s^:%s: %w", sha, filePath, err)
		}
		diff.Original = content
	}

	return diff, nil
}
