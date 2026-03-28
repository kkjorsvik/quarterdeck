package git

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// StashEntry represents a single stash entry.
type StashEntry struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
	Date    string `json:"date"`
}

// StashPush creates a new stash entry with the given message.
func StashPush(repoPath, message string) error {
	args := []string{"stash", "push"}
	if message != "" {
		args = append(args, "-m", message)
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git stash push: %s: %w", string(out), err)
	}
	return nil
}

// StashList returns all stash entries.
func StashList(repoPath string) ([]StashEntry, error) {
	cmd := exec.Command("git", "stash", "list", "--format=%gd||%s||%aI")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git stash list: %w", err)
	}

	var entries []StashEntry
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "||", 3)
		if len(parts) < 2 {
			continue
		}

		// Parse index from "stash@{0}"
		idx := 0
		ref := parts[0]
		if start := strings.Index(ref, "{"); start >= 0 {
			if end := strings.Index(ref, "}"); end > start {
				idx, _ = strconv.Atoi(ref[start+1 : end])
			}
		}

		date := ""
		if len(parts) >= 3 {
			date = parts[2]
		}

		entries = append(entries, StashEntry{
			Index:   idx,
			Message: parts[1],
			Date:    date,
		})
	}

	return entries, nil
}

// StashPop applies and removes a stash entry by index.
func StashPop(repoPath string, index int) error {
	ref := fmt.Sprintf("stash@{%d}", index)
	cmd := exec.Command("git", "stash", "pop", ref)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git stash pop %s: %s: %w", ref, string(out), err)
	}
	return nil
}

// StashDrop removes a stash entry by index without applying it.
func StashDrop(repoPath string, index int) error {
	ref := fmt.Sprintf("stash@{%d}", index)
	cmd := exec.Command("git", "stash", "drop", ref)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git stash drop %s: %s: %w", ref, string(out), err)
	}
	return nil
}
