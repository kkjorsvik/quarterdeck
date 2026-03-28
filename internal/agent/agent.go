package agent

import "time"

type AgentStatus string

const (
	AgentStatusStarting   AgentStatus = "starting"
	AgentStatusWorking    AgentStatus = "working"
	AgentStatusNeedsInput AgentStatus = "needs_input"
	AgentStatusDone       AgentStatus = "done"
	AgentStatusError      AgentStatus = "error"
)

type Agent struct {
	ID           string      `json:"id"`
	RunID        int64       `json:"runId"`
	ProjectID    int64       `json:"projectId"`
	Type         string      `json:"type"`
	DisplayName  string      `json:"displayName"`
	Command      string      `json:"command"`
	Status       AgentStatus `json:"status"`
	TaskDesc     string      `json:"taskDescription"`
	PTYSessionID string      `json:"ptySessionId"`
	WorkDir      string      `json:"workDir"`
	BaseCommit   string      `json:"baseCommit"`
	StartedAt    time.Time   `json:"startedAt"`
	ExitCode     *int        `json:"exitCode"`
}

type AgentConfig struct {
	Type        string
	DisplayName string
	Command     string
	Icon        string
}

var BuiltinAgents = map[string]AgentConfig{
	"claude_code": {Type: "claude_code", DisplayName: "Claude Code", Command: "claude", Icon: "CC"},
	"codex":       {Type: "codex", DisplayName: "Codex", Command: "codex", Icon: "CX"},
	"opencode":    {Type: "opencode", DisplayName: "OpenCode", Command: "opencode", Icon: "OC"},
}

type SpawnResult struct {
	AgentID      string `json:"agentId"`
	PTYSessionID string `json:"ptySessionId"`
}
