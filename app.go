package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	agentPkg "github.com/kkjorsvik/quarterdeck/internal/agent"
	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/filetree"
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
	ptyMgr   *ptyPkg.Manager
	agentMgr *agentPkg.Manager
	wsServer *ws.Server
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

	// Initialize agent manager
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
