package agent

import (
	"database/sql"
	"fmt"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

// RunService provides queries for agent runs and file changes.
type RunService struct {
	store *db.Store
}

// NewRunService creates a new RunService.
func NewRunService(store *db.Store) *RunService {
	return &RunService{store: store}
}

// AgentRunWithStats represents an agent run with aggregated file change stats.
type AgentRunWithStats struct {
	ID              int64  `json:"id"`
	ProjectID       int64  `json:"projectId"`
	AgentType       string `json:"agentType"`
	TaskDescription string `json:"taskDescription"`
	BaseCommit      string `json:"baseCommit"`
	EndCommit       string `json:"endCommit"`
	Status          string `json:"status"`
	StartedAt       string `json:"startedAt"`
	CompletedAt     string `json:"completedAt"`
	AgentID         string `json:"agentId"`
	FileCount       int    `json:"fileCount"`
	TotalAdditions  int    `json:"totalAdditions"`
	TotalDeletions  int    `json:"totalDeletions"`
}

// RunFileChange represents a single file change within a run.
type RunFileChange struct {
	ID         int64  `json:"id"`
	RunID      int64  `json:"runId"`
	FilePath   string `json:"filePath"`
	ChangeType string `json:"changeType"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
}

// FileDiff contains original and modified content for a single file.
type FileDiff struct {
	FilePath   string `json:"filePath"`
	Original   string `json:"original"`
	Modified   string `json:"modified"`
	ChangeType string `json:"changeType"`
}

// ListProjectRuns returns all runs for a project with aggregated stats.
func (s *RunService) ListProjectRuns(projectID int64) ([]AgentRunWithStats, error) {
	rows, err := s.store.DB.Query(`
		SELECT
			r.id, r.project_id, r.agent_type, COALESCE(r.task_description,''),
			COALESCE(r.base_commit,''), COALESCE(r.end_commit,''), r.status,
			COALESCE(r.started_at,''), COALESCE(r.completed_at,''),
			COALESCE(r.agent_id,''),
			COUNT(fc.id) AS file_count,
			COALESCE(SUM(fc.additions),0) AS total_additions,
			COALESCE(SUM(fc.deletions),0) AS total_deletions
		FROM agent_runs r
		LEFT JOIN run_file_changes fc ON fc.run_id = r.id
		WHERE r.project_id = ?
		GROUP BY r.id
		ORDER BY r.started_at DESC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list project runs: %w", err)
	}
	defer rows.Close()

	var runs []AgentRunWithStats
	for rows.Next() {
		var r AgentRunWithStats
		if err := rows.Scan(
			&r.ID, &r.ProjectID, &r.AgentType, &r.TaskDescription,
			&r.BaseCommit, &r.EndCommit, &r.Status,
			&r.StartedAt, &r.CompletedAt, &r.AgentID,
			&r.FileCount, &r.TotalAdditions, &r.TotalDeletions,
		); err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

// GetRunFileChanges returns all file changes for a given run.
func (s *RunService) GetRunFileChanges(runID int64) ([]RunFileChange, error) {
	rows, err := s.store.DB.Query(`
		SELECT id, run_id, file_path, change_type,
			COALESCE(additions,0), COALESCE(deletions,0)
		FROM run_file_changes
		WHERE run_id = ?
		ORDER BY change_type, file_path
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("get run file changes: %w", err)
	}
	defer rows.Close()

	var changes []RunFileChange
	for rows.Next() {
		var c RunFileChange
		if err := rows.Scan(&c.ID, &c.RunID, &c.FilePath, &c.ChangeType, &c.Additions, &c.Deletions); err != nil {
			return nil, fmt.Errorf("scan file change: %w", err)
		}
		changes = append(changes, c)
	}
	return changes, rows.Err()
}

// GetRunByAgentID looks up a single run by its agent_id with aggregated stats.
func (s *RunService) GetRunByAgentID(agentID string) (*AgentRunWithStats, error) {
	row := s.store.DB.QueryRow(`
		SELECT
			r.id, r.project_id, r.agent_type, COALESCE(r.task_description,''),
			COALESCE(r.base_commit,''), COALESCE(r.end_commit,''), r.status,
			COALESCE(r.started_at,''), COALESCE(r.completed_at,''),
			COALESCE(r.agent_id,''),
			COUNT(fc.id) AS file_count,
			COALESCE(SUM(fc.additions),0) AS total_additions,
			COALESCE(SUM(fc.deletions),0) AS total_deletions
		FROM agent_runs r
		LEFT JOIN run_file_changes fc ON fc.run_id = r.id
		WHERE r.agent_id = ?
		GROUP BY r.id
	`, agentID)

	var r AgentRunWithStats
	if err := row.Scan(
		&r.ID, &r.ProjectID, &r.AgentType, &r.TaskDescription,
		&r.BaseCommit, &r.EndCommit, &r.Status,
		&r.StartedAt, &r.CompletedAt, &r.AgentID,
		&r.FileCount, &r.TotalAdditions, &r.TotalDeletions,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("run not found for agent %s", agentID)
		}
		return nil, fmt.Errorf("get run by agent id: %w", err)
	}
	return &r, nil
}
