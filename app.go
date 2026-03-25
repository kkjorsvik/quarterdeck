package main

import (
	"context"
	"os"
	"path/filepath"

	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/filetree"
	"github.com/kkjorsvik/quarterdeck/internal/project"
	ptyPkg "github.com/kkjorsvik/quarterdeck/internal/pty"
	"github.com/kkjorsvik/quarterdeck/internal/ws"
)

type App struct {
	ctx      context.Context
	store    *db.Store
	projects *project.Service
	fileTree *filetree.Service
	ptyMgr   *ptyPkg.Manager
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
	a.fileTree = filetree.NewService()
	a.ptyMgr = ptyPkg.NewManager()

	// Start WebSocket server
	wsSrv, err := ws.NewServer(a.ptyMgr)
	if err != nil {
		panic("failed to start ws server: " + err.Error())
	}
	a.wsServer = wsSrv
}

func (a *App) shutdown(ctx context.Context) {
	if a.wsServer != nil {
		a.wsServer.Close()
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
	return a.projects.Delete(id)
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
	return a.ptyMgr.Create(shell, workDir, uint16(cols), uint16(rows))
}

func (a *App) ResizeTerminal(id string, cols, rows int) error {
	return a.ptyMgr.Resize(id, uint16(cols), uint16(rows))
}

func (a *App) CloseTerminal(id string) error {
	return a.ptyMgr.Close(id)
}
