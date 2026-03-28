package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"fmt"

	agentPkg "github.com/kkjorsvik/quarterdeck/internal/agent"
	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/filetree"
	gitPkg "github.com/kkjorsvik/quarterdeck/internal/git"
	"github.com/kkjorsvik/quarterdeck/internal/layout"
	"github.com/kkjorsvik/quarterdeck/internal/project"
	ptyPkg "github.com/kkjorsvik/quarterdeck/internal/pty"
	"github.com/kkjorsvik/quarterdeck/internal/ws"
)

type App struct {
	ctx      context.Context
	store    *db.Store
	projects *project.Service
	layouts  *layout.Service
	fileTree *filetree.Service
	ptyMgr     *ptyPkg.Manager
	agentMgr   *agentPkg.Manager
	runService *agentPkg.RunService
	wsServer   *ws.Server
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Open database
	configDir, _ := os.UserConfigDir()
	dbPath := filepath.Join(configDir, "quarterdeck", "quarterdeck.db")
	store, err := db.Open(dbPath)
	if err != nil {
		panic("failed to open database: " + err.Error())
	}
	a.store = store

	// Initialize services
	a.projects = project.NewService(store)
	a.layouts = layout.NewService(store)
	a.fileTree = filetree.NewService()
	a.ptyMgr = ptyPkg.NewManager()

	// Initialize run service and agent manager
	a.runService = agentPkg.NewRunService(a.store)
	a.agentMgr = agentPkg.NewManager(a.ptyMgr, a.store, func(data []byte) {
		if a.wsServer != nil {
			a.wsServer.EventHub().Broadcast(data)
		}
	})

	// Start WebSocket server
	wsSrv, err := ws.NewServer(a.ptyMgr, a.agentMgr)
	if err != nil {
		panic("failed to start ws server: " + err.Error())
	}
	a.wsServer = wsSrv
}

func (a *App) shutdown(ctx context.Context) {
	if a.wsServer != nil {
		a.wsServer.Close()
	}
	if a.agentMgr != nil {
		a.agentMgr.Shutdown()
	}
	if a.ptyMgr != nil {
		a.ptyMgr.CloseAll()
	}
	if a.store != nil {
		a.store.Close()
	}
}

// --- Wails-bound methods (callable from frontend) ---

func (a *App) GetWSPort() int {
	return a.wsServer.Port()
}

// Project methods
func (a *App) AddProject(name, path string) (*project.Project, error) {
	return a.projects.Add(name, path)
}

func (a *App) ListProjects() ([]project.Project, error) {
	return a.projects.List()
}

func (a *App) GetProject(id int64) (*project.Project, error) {
	return a.projects.Get(id)
}

func (a *App) DeleteProject(id int64) error {
	a.agentMgr.StopByProject(id)
	return a.projects.Delete(id)
}

func (a *App) UpdateProject(id int64, fields project.UpdateFields) error {
	return a.projects.Update(id, fields)
}

// Layout methods
func (a *App) SaveLayout(projectID int64, layoutJSON string) error {
	return a.layouts.Save(projectID, layoutJSON)
}

func (a *App) GetLayout(projectID int64) (string, error) {
	return a.layouts.Get(projectID)
}

func (a *App) GetAllLayouts() (map[int64]string, error) {
	return a.layouts.GetAll()
}

// File tree methods
func (a *App) ReadDir(path string) ([]filetree.FileEntry, error) {
	return a.fileTree.ReadDir(path)
}

func (a *App) ReadDirFiltered(path string) ([]filetree.FileEntry, error) {
	return a.fileTree.ReadDirFiltered(path)
}

func (a *App) ReadFile(path string) (string, error) {
	return a.fileTree.ReadFile(path)
}

func (a *App) WriteFile(path, content string) error {
	return a.fileTree.WriteFile(path, content)
}

// Terminal methods
func (a *App) CreateTerminal(workDir string, cols, rows int) (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	return a.ptyMgr.Create(shell, nil, workDir, uint16(cols), uint16(rows))
}

func (a *App) ResizeTerminal(id string, cols, rows int) error {
	return a.ptyMgr.Resize(id, uint16(cols), uint16(rows))
}

func (a *App) CloseTerminal(id string) error {
	return a.ptyMgr.Close(id)
}

func (a *App) ListProjectFiles(projectPath string) ([]string, error) {
	cmd := exec.Command("git", "ls-files")
	cmd.Dir = projectPath
	output, err := cmd.Output()
	if err != nil {
		return a.fileTree.ListFiles(projectPath)
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return []string{}, nil
	}
	return lines, nil
}

func (a *App) GetGitBranch(projectPath string) string {
	cmd := exec.Command("git", "-C", projectPath, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Agent methods
func (a *App) SpawnAgent(projectID int64, agentType, taskDesc, workDir, customCmd string) (*agentPkg.SpawnResult, error) {
	agent, err := a.agentMgr.Spawn(projectID, agentType, taskDesc, workDir, customCmd)
	if err != nil {
		return nil, err
	}
	return &agentPkg.SpawnResult{
		AgentID:      agent.ID,
		PTYSessionID: agent.PTYSessionID,
	}, nil
}

func (a *App) StopAgent(agentID string) error {
	return a.agentMgr.Stop(agentID)
}

func (a *App) ListAgents() []*agentPkg.Agent {
	return a.agentMgr.List()
}

func (a *App) ListProjectAgents(projectID int64) []*agentPkg.Agent {
	return a.agentMgr.ListByProject(projectID)
}

// --- Review workflow bindings ---

func (a *App) ListProjectRuns(projectID int64) ([]agentPkg.AgentRunWithStats, error) {
	return a.runService.ListProjectRuns(projectID)
}

func (a *App) GetRunFileChanges(runID int64) ([]agentPkg.RunFileChange, error) {
	return a.runService.GetRunFileChanges(runID)
}

func (a *App) GetRunByAgentID(agentID string) (*agentPkg.AgentRunWithStats, error) {
	return a.runService.GetRunByAgentID(agentID)
}

func (a *App) GetFileDiff(projectID int64, baseCommit, endCommit, filePath string) (*agentPkg.FileDiff, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// Determine change type from diff
	changes, err := gitPkg.DiffFileList(proj.Path, baseCommit, endCommit)
	if err != nil {
		return nil, fmt.Errorf("diff file list: %w", err)
	}
	changeType := "M"
	for _, c := range changes {
		if c.Path == filePath {
			changeType = c.ChangeType
			break
		}
	}

	var original, modified string
	if changeType != "A" {
		original, err = gitPkg.ShowFile(proj.Path, baseCommit, filePath)
		if err != nil {
			return nil, fmt.Errorf("show original: %w", err)
		}
	}
	if changeType != "D" {
		modified, err = gitPkg.ShowFile(proj.Path, endCommit, filePath)
		if err != nil {
			return nil, fmt.Errorf("show modified: %w", err)
		}
	}

	return &agentPkg.FileDiff{
		FilePath:   filePath,
		Original:   original,
		Modified:   modified,
		ChangeType: changeType,
	}, nil
}

func (a *App) RevertFile(projectID int64, baseCommit, filePath, changeType string) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}

	switch changeType {
	case "A":
		// New file — remove it
		fullPath := filepath.Join(proj.Path, filePath)
		if err := os.Remove(fullPath); err != nil {
			return fmt.Errorf("remove added file: %w", err)
		}
	case "M", "D":
		// Modified or deleted — restore from base commit
		cmd := exec.Command("git", "checkout", baseCommit, "--", filePath)
		cmd.Dir = proj.Path
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git checkout: %s: %w", string(out), err)
		}
	default:
		return fmt.Errorf("unknown change type: %s", changeType)
	}
	return nil
}

func (a *App) CommitReviewedChanges(projectID int64, message string, filePaths []string, push bool) (string, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return "", fmt.Errorf("get project: %w", err)
	}

	// Stage each file
	for _, fp := range filePaths {
		cmd := exec.Command("git", "add", fp)
		cmd.Dir = proj.Path
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("git add %s: %s: %w", fp, string(out), err)
		}
	}

	// Commit
	cmd := exec.Command("git", "commit", "-m", message)
	cmd.Dir = proj.Path
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git commit: %s: %w", string(out), err)
	}

	// Get new SHA
	sha, err := gitPkg.HeadCommit(proj.Path)
	if err != nil {
		return "", fmt.Errorf("get new head: %w", err)
	}

	// Optional push
	if push {
		cmd := exec.Command("git", "push")
		cmd.Dir = proj.Path
		if out, err := cmd.CombinedOutput(); err != nil {
			return sha, fmt.Errorf("git push: %s: %w", string(out), err)
		}
	}

	return sha, nil
}

func (a *App) GetWorkingTreeChanges(projectID int64) ([]agentPkg.RunFileChange, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	changes, err := gitPkg.DiffWorkingTree(proj.Path)
	if err != nil {
		return nil, fmt.Errorf("diff working tree: %w", err)
	}

	numstat, err := gitPkg.DiffNumstatWorkingTree(proj.Path)
	if err != nil {
		// Non-fatal: numstat may fail for untracked files
		numstat = make(map[string][2]int)
	}

	var result []agentPkg.RunFileChange
	for _, c := range changes {
		fc := agentPkg.RunFileChange{
			FilePath:   c.Path,
			ChangeType: c.ChangeType,
		}
		if stat, ok := numstat[c.Path]; ok {
			fc.Additions = stat[0]
			fc.Deletions = stat[1]
		}
		result = append(result, fc)
	}
	return result, nil
}

func (a *App) GetWorkingTreeFileDiff(projectID int64, filePath string) (*agentPkg.FileDiff, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// Determine change type
	changes, err := gitPkg.DiffWorkingTree(proj.Path)
	if err != nil {
		return nil, fmt.Errorf("diff working tree: %w", err)
	}
	changeType := "M"
	for _, c := range changes {
		if c.Path == filePath {
			changeType = c.ChangeType
			break
		}
	}

	var original string
	if changeType != "A" {
		original, err = gitPkg.ShowFile(proj.Path, "HEAD", filePath)
		if err != nil {
			return nil, fmt.Errorf("show original: %w", err)
		}
	}

	var modified string
	if changeType != "D" {
		fullPath := filepath.Join(proj.Path, filePath)
		content, err := a.fileTree.ReadFile(fullPath)
		if err != nil {
			return nil, fmt.Errorf("read modified: %w", err)
		}
		modified = content
	}

	return &agentPkg.FileDiff{
		FilePath:   filePath,
		Original:   original,
		Modified:   modified,
		ChangeType: changeType,
	}, nil
}
