package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"fmt"

	"github.com/kkjorsvik/quarterdeck/internal/activity"
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
	ctx         context.Context
	store       *db.Store
	projects    *project.Service
	layouts     *layout.Service
	fileTree    *filetree.Service
	ptyMgr      *ptyPkg.Manager
	ptyLogger   *ptyPkg.Logger
	agentMgr    *agentPkg.Manager
	runService  *agentPkg.RunService
	activitySvc *activity.Service
	wsServer    *ws.Server
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

	// Initialize PTY logger for disk-based terminal output
	logDir := filepath.Join(filepath.Dir(a.store.Path()), "logs")
	ptyLogger, err := ptyPkg.NewLogger(logDir)
	if err != nil {
		fmt.Printf("warning: failed to create PTY logger: %v\n", err)
	} else {
		a.ptyLogger = ptyLogger
	}

	// Initialize activity service
	a.activitySvc = activity.NewService(a.store.DB, func(data []byte) {
		if a.wsServer != nil {
			a.wsServer.EventHub().Broadcast(data)
		}
	})

	// Initialize run service and agent manager
	a.runService = agentPkg.NewRunService(a.store)
	a.agentMgr = agentPkg.NewManager(a.ptyMgr, a.store, func(data []byte) {
		if a.wsServer != nil {
			a.wsServer.EventHub().Broadcast(data)
		}
	}, a.activitySvc, a.ptyLogger)

	// Start WebSocket server
	wsSrv, err := ws.NewServer(a.ptyMgr, a.agentMgr, a.ptyLogger)
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
	if a.ptyLogger != nil {
		a.ptyLogger.CloseAll()
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

func (a *App) GetAgentLog(ptySessionID string) (string, error) {
	if a.ptyLogger == nil {
		return "", fmt.Errorf("PTY logging not available")
	}
	return a.ptyLogger.ReadLog(ptySessionID)
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

// Activity event methods
func (a *App) ListActivityEvents(limit, offset int) ([]activity.Event, error) {
	return a.activitySvc.List(limit, offset)
}

func (a *App) ListProjectActivityEvents(projectID int64, limit int) ([]activity.Event, error) {
	return a.activitySvc.ListByProject(projectID, limit)
}

func (a *App) GetAgentStateHistory(agentID string) ([]map[string]string, error) {
	return a.activitySvc.GetStateHistory(agentID)
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

// --- Git integration bindings ---

// GetGitStatus returns the git status of all files in the project.
func (a *App) GetGitStatus(projectID int64) ([]gitPkg.FileStatus, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.GetStatus(proj.Path)
}

// ListWorktrees returns all git worktrees for the project.
func (a *App) ListWorktrees(projectID int64) ([]gitPkg.Worktree, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.ListWorktrees(proj.Path)
}

// CreateWorktree creates a new worktree with a new branch and returns its path.
func (a *App) CreateWorktree(projectID int64, branchName string) (string, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return "", fmt.Errorf("get project: %w", err)
	}

	// Determine worktree path
	wtDir := filepath.Join(proj.Path, ".worktrees")
	wtPath := filepath.Join(wtDir, branchName)

	// Ensure .worktrees/ is in .gitignore
	ensureGitignoreEntry(proj.Path, ".worktrees/")

	// Create the worktree
	if err := gitPkg.CreateWorktree(proj.Path, wtPath, branchName); err != nil {
		return "", fmt.Errorf("create worktree: %w", err)
	}

	// Insert DB row
	_, err = a.store.DB.Exec(
		"INSERT INTO worktrees (project_id, path, branch) VALUES (?, ?, ?)",
		projectID, wtPath, branchName,
	)
	if err != nil {
		return "", fmt.Errorf("insert worktree row: %w", err)
	}

	return wtPath, nil
}

// RemoveWorktree removes a git worktree.
func (a *App) RemoveWorktree(projectID int64, worktreePath string, force bool) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	if err := gitPkg.RemoveWorktree(proj.Path, worktreePath, force); err != nil {
		return err
	}
	a.store.DB.Exec("DELETE FROM worktrees WHERE project_id = ? AND path = ?", projectID, worktreePath)
	return nil
}

// AssignWorktreeAgent assigns an agent to a worktree.
func (a *App) AssignWorktreeAgent(worktreeID int64, agentID string) error {
	_, err := a.store.DB.Exec("UPDATE worktrees SET agent_id = ? WHERE id = ?", agentID, worktreeID)
	return err
}

// ListBranches returns all local branches for the project.
func (a *App) ListBranches(projectID int64) ([]gitPkg.Branch, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.ListBranches(proj.Path)
}

// CreateBranch creates a new branch in the project repo.
func (a *App) CreateBranch(projectID int64, name, startPoint string) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.CreateBranch(proj.Path, name, startPoint)
}

// SwitchBranch switches the current branch in the project repo.
func (a *App) SwitchBranch(projectID int64, name string) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.SwitchBranch(proj.Path, name)
}

// DeleteBranch deletes a branch from the project repo.
func (a *App) DeleteBranch(projectID int64, name string, force bool) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.DeleteBranch(proj.Path, name, force)
}

// MergeBranch merges a branch into the current branch.
func (a *App) MergeBranch(projectID int64, name string) (*gitPkg.MergeResult, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.MergeBranch(proj.Path, name)
}

// MergeWorktreeBranch merges a worktree branch into the main branch.
func (a *App) MergeWorktreeBranch(projectID int64, branchName string) (*gitPkg.MergeResult, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.MergeBranch(proj.Path, branchName)
}

// CleanupWorktree removes a worktree, prunes, and optionally deletes the branch.
func (a *App) CleanupWorktree(projectID int64, worktreePath string, deleteBranch bool) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}

	// Find the branch name from the worktree before removing
	var branchName string
	wts, err := gitPkg.ListWorktrees(proj.Path)
	if err == nil {
		for _, wt := range wts {
			if wt.Path == worktreePath {
				branchName = wt.Branch
				break
			}
		}
	}

	// Remove the worktree
	if err := gitPkg.RemoveWorktree(proj.Path, worktreePath, true); err != nil {
		return fmt.Errorf("remove worktree: %w", err)
	}

	// Prune worktrees
	cmd := exec.Command("git", "worktree", "prune")
	cmd.Dir = proj.Path
	cmd.CombinedOutput()

	// Optionally delete the branch
	if deleteBranch && branchName != "" {
		gitPkg.DeleteBranch(proj.Path, branchName, true)
	}

	// Delete DB row
	a.store.DB.Exec("DELETE FROM worktrees WHERE project_id = ? AND path = ?", projectID, worktreePath)

	return nil
}

// HasConflicts returns whether the project repo has merge conflicts.
func (a *App) HasConflicts(projectID int64) (bool, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return false, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.HasConflicts(proj.Path)
}

// ListConflictFiles returns files with merge conflicts.
func (a *App) ListConflictFiles(projectID int64) ([]string, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.ListConflictFiles(proj.Path)
}

// MarkFileResolved marks a conflicted file as resolved.
func (a *App) MarkFileResolved(projectID int64, filePath string) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.MarkFileResolved(proj.Path, filePath)
}

// CompleteMerge completes an in-progress merge.
func (a *App) CompleteMerge(projectID int64) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.CompleteMerge(proj.Path)
}

// AbortMerge aborts an in-progress merge.
func (a *App) AbortMerge(projectID int64) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.AbortMerge(proj.Path)
}

// GetGitLog returns commit log entries for the project.
func (a *App) GetGitLog(projectID int64, limit, offset int) ([]gitPkg.CommitInfo, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.GetLog(proj.Path, limit, offset)
}

// GetCommitFileChanges returns file changes for a specific commit.
func (a *App) GetCommitFileChanges(projectID int64, sha string) ([]gitPkg.FileChange, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.GetCommitFileChanges(proj.Path, sha)
}

// GetCommitFileDiff returns the diff for a file at a specific commit.
func (a *App) GetCommitFileDiff(projectID int64, sha, filePath string) (*gitPkg.FileDiff, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.GetCommitFileDiff(proj.Path, sha, filePath)
}

// StashPush creates a new stash entry.
func (a *App) StashPush(projectID int64, message string) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.StashPush(proj.Path, message)
}

// StashList returns all stash entries for the project.
func (a *App) StashList(projectID int64) ([]gitPkg.StashEntry, error) {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return gitPkg.StashList(proj.Path)
}

// StashPop applies and removes a stash entry.
func (a *App) StashPop(projectID int64, index int) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.StashPop(proj.Path, index)
}

// StashDrop removes a stash entry without applying it.
func (a *App) StashDrop(projectID int64, index int) error {
	proj, err := a.projects.Get(projectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	return gitPkg.StashDrop(proj.Path, index)
}

// ensureGitignoreEntry adds an entry to .gitignore if not already present.
func ensureGitignoreEntry(repoPath, entry string) {
	gitignorePath := filepath.Join(repoPath, ".gitignore")
	content, err := os.ReadFile(gitignorePath)
	if err != nil && !os.IsNotExist(err) {
		return
	}

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == entry {
			return // already present
		}
	}

	f, err := os.OpenFile(gitignorePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	if len(content) > 0 && content[len(content)-1] != '\n' {
		f.WriteString("\n")
	}
	f.WriteString(entry + "\n")
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
