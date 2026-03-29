package agent

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kkjorsvik/quarterdeck/internal/db"
	gitPkg "github.com/kkjorsvik/quarterdeck/internal/git"
	"github.com/kkjorsvik/quarterdeck/internal/pty"
)

// ActivityRecorder records activity events and state transitions.
type ActivityRecorder interface {
	Record(eventType, agentID string, projectID int64, title, detail string) error
	RecordStateTransition(agentID, fromState, toState string) error
}

type Manager struct {
	mu        sync.RWMutex
	agents    map[string]*Agent
	detectors map[string]*StateDetector // keyed by PTY session ID
	ptyMgr    *pty.Manager
	store     *db.Store
	broadcast func([]byte)
	activity  ActivityRecorder
}

func NewManager(ptyMgr *pty.Manager, store *db.Store, broadcast func([]byte), activity ActivityRecorder) *Manager {
	return &Manager{
		agents:    make(map[string]*Agent),
		detectors: make(map[string]*StateDetector),
		ptyMgr:    ptyMgr,
		store:     store,
		broadcast: broadcast,
		activity:  activity,
	}
}

func (m *Manager) Spawn(projectID int64, agentType, taskDesc, workDir, customCmd string) (*Agent, error) {
	var command string
	var args []string
	var displayName string
	var icon string

	if cfg, ok := BuiltinAgents[agentType]; ok {
		command = cfg.Command
		displayName = cfg.DisplayName
		icon = cfg.Icon
		if agentType == "claude_code" && taskDesc != "" {
			args = []string{"-p", taskDesc}
		}
	} else {
		// Custom agent
		parts := strings.Fields(customCmd)
		if len(parts) == 0 {
			return nil, fmt.Errorf("empty custom command")
		}
		command = parts[0]
		if len(parts) > 1 {
			args = parts[1:]
		}
		displayName = command
		runes := []rune(customCmd)
		if len(runes) >= 2 {
			icon = string(runes[:2])
		} else {
			icon = customCmd
		}
	}

	// Verify command exists
	if _, err := exec.LookPath(command); err != nil {
		return nil, fmt.Errorf("command not found: %s", command)
	}

	// Capture git HEAD (best effort)
	var baseCommit string
	gitCmd := exec.Command("git", "-C", workDir, "rev-parse", "HEAD")
	if out, err := gitCmd.Output(); err == nil {
		baseCommit = strings.TrimSpace(string(out))
	}

	// Create PTY session
	sessionID, err := m.ptyMgr.Create(command, args, workDir, 120, 30)
	if err != nil {
		return nil, fmt.Errorf("create pty session: %w", err)
	}

	// Create agent_runs DB row
	var runID int64
	res, err := m.store.DB.Exec(
		`INSERT INTO agent_runs (project_id, agent_type, task_description, base_commit, status, agent_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		projectID, agentType, taskDesc, baseCommit, string(AgentStatusStarting), "",
	)
	if err != nil {
		log.Printf("failed to create agent_runs row: %v", err)
	} else {
		runID, _ = res.LastInsertId()
	}

	agentID := uuid.New().String()

	// Update agent_id in DB
	if runID > 0 {
		m.store.DB.Exec("UPDATE agent_runs SET agent_id = ? WHERE id = ?", agentID, runID)
	}

	agent := &Agent{
		ID:           agentID,
		RunID:        runID,
		ProjectID:    projectID,
		Type:         agentType,
		DisplayName:  displayName,
		Command:      command,
		Status:       AgentStatusStarting,
		TaskDesc:     taskDesc,
		PTYSessionID: sessionID,
		WorkDir:      workDir,
		BaseCommit:   baseCommit,
		StartedAt:    time.Now(),
	}
	_ = icon // stored in config, not on agent struct

	// Create detector
	detector := NewDetector(agentType, func(status AgentStatus) {
		m.onStatusChange(agent, status)
	})

	// Get session reference before registering (needed for exit watcher)
	sess, ok := m.ptyMgr.Get(sessionID)
	if !ok {
		return nil, fmt.Errorf("pty session disappeared")
	}

	m.mu.Lock()
	m.agents[agentID] = agent
	m.detectors[sessionID] = detector
	m.mu.Unlock()

	// Start exit watcher with direct session reference
	go m.watchExit(agent, detector, sess)

	// Record activity event for spawn
	if m.activity != nil {
		title := fmt.Sprintf("Agent %s spawned", displayName)
		m.activity.Record("agent_spawned", agentID, projectID, title, taskDesc)
	}

	return agent, nil
}

func (m *Manager) Get(id string) *Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.agents[id]
}

func (m *Manager) List() []*Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Agent, 0, len(m.agents))
	for _, a := range m.agents {
		result = append(result, a)
	}
	return result
}

func (m *Manager) ListByProject(projectID int64) []*Agent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var result []*Agent
	for _, a := range m.agents {
		if a.ProjectID == projectID {
			result = append(result, a)
		}
	}
	return result
}

func (m *Manager) Stop(id string) error {
	m.mu.RLock()
	agent, ok := m.agents[id]
	if !ok {
		m.mu.RUnlock()
		return fmt.Errorf("agent %s not found", id)
	}
	detector := m.detectors[agent.PTYSessionID]
	m.mu.RUnlock()

	if detector != nil {
		detector.Stop()
	}
	return m.ptyMgr.Close(agent.PTYSessionID)
}

func (m *Manager) StopByProject(projectID int64) {
	agents := m.ListByProject(projectID)
	for _, a := range agents {
		m.Stop(a.ID)
	}
}

// FeedDetector implements ws.DetectorLookup.
func (m *Manager) FeedDetector(ptySessionID string, data []byte) {
	m.mu.RLock()
	detector, ok := m.detectors[ptySessionID]
	m.mu.RUnlock()
	if ok {
		detector.Feed(data)
	}
}

func (m *Manager) Shutdown() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.agents))
	for id := range m.agents {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

func (m *Manager) watchExit(agent *Agent, detector *StateDetector, sess *pty.Session) {
	<-sess.Done
	exitCode := sess.ExitCode
	agent.ExitCode = &exitCode
	detector.OnProcessExit(&exitCode)
}

func (m *Manager) onStatusChange(agent *Agent, status AgentStatus) {
	m.mu.Lock()
	prevStatus := agent.Status
	agent.Status = status
	m.mu.Unlock()

	// Record state transition and activity event
	if m.activity != nil {
		m.activity.RecordStateTransition(agent.ID, string(prevStatus), string(status))
		title := fmt.Sprintf("Agent %s status: %s", agent.DisplayName, string(status))
		m.activity.Record("agent_status_change", agent.ID, agent.ProjectID, title, "")
	}

	// Update DB
	if agent.RunID > 0 {
		dbStatus := string(status)
		if status == AgentStatusDone || status == AgentStatusError {
			m.store.DB.Exec(
				"UPDATE agent_runs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
				dbStatus, agent.RunID,
			)
		} else {
			m.store.DB.Exec(
				"UPDATE agent_runs SET status = ? WHERE id = ?",
				dbStatus, agent.RunID,
			)
		}
	}

	// Notifications
	projectName := fmt.Sprintf("[project %d]", agent.ProjectID)
	var pName string
	if err := m.store.DB.QueryRow("SELECT name FROM projects WHERE id = ?", agent.ProjectID).Scan(&pName); err == nil {
		projectName = fmt.Sprintf("[%s]", pName)
	}

	switch status {
	case AgentStatusNeedsInput:
		Notify(projectName+" Agent needs input", agent.DisplayName, "normal")
	case AgentStatusDone:
		Notify(projectName+" Agent finished", agent.DisplayName, "low")
	case AgentStatusError:
		body := agent.DisplayName
		if agent.ExitCode != nil {
			body = fmt.Sprintf("%s (exit code %d)", agent.DisplayName, *agent.ExitCode)
		}
		Notify(projectName+" Agent errored", body, "critical")
	}

	// Track run on completion
	if status == AgentStatusDone || status == AgentStatusError {
		m.trackRun(agent)
	}

	// Broadcast event
	event := map[string]any{
		"type":    "agent_status",
		"agentId": agent.ID,
		"status":  string(status),
	}
	data, err := json.Marshal(event)
	if err == nil {
		m.broadcast(data)
	}
}

func (m *Manager) trackRun(agent *Agent) {
	if agent.BaseCommit == "" || agent.RunID == 0 {
		return
	}

	endCommit, err := gitPkg.HeadCommit(agent.WorkDir)
	if err != nil {
		log.Printf("run tracking: failed to get HEAD: %v", err)
		return
	}

	var changes []gitPkg.FileChange
	var numstat map[string][2]int
	if endCommit != agent.BaseCommit {
		changes, err = gitPkg.DiffFileList(agent.WorkDir, agent.BaseCommit, endCommit)
		if err != nil {
			log.Printf("run tracking: failed to get diff: %v", err)
		}
		numstat, err = gitPkg.DiffNumstat(agent.WorkDir, agent.BaseCommit, endCommit)
		if err != nil {
			log.Printf("run tracking: failed to get numstat: %v", err)
		}
	} else {
		changes, err = gitPkg.DiffWorkingTree(agent.WorkDir)
		if err != nil {
			log.Printf("run tracking: failed to get diff: %v", err)
		}
		numstat, err = gitPkg.DiffNumstatWorkingTree(agent.WorkDir)
		if err != nil {
			log.Printf("run tracking: failed to get numstat: %v", err)
		}
	}

	if _, err := m.store.DB.Exec(
		"UPDATE agent_runs SET end_commit = ? WHERE id = ?",
		endCommit, agent.RunID,
	); err != nil {
		log.Printf("run tracking: failed to update end_commit: %v", err)
	}

	for _, change := range changes {
		var additions, deletions int
		if numstat != nil {
			if stat, ok := numstat[change.Path]; ok {
				additions = stat[0]
				deletions = stat[1]
			}
		}
		if _, err := m.store.DB.Exec(
			"INSERT INTO run_file_changes (run_id, file_path, change_type, additions, deletions) VALUES (?, ?, ?, ?, ?)",
			agent.RunID, change.Path, change.ChangeType, additions, deletions,
		); err != nil {
			log.Printf("run tracking: failed to insert file change: %v", err)
		}
	}
}
