package agent

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/kkjorsvik/quarterdeck/internal/db"
	"github.com/kkjorsvik/quarterdeck/internal/pty"
)

func setupTestEnv(t *testing.T) (*db.Store, *pty.Manager) {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	// Insert test projects so FK constraints pass
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (1, 'test1', '/tmp/test1')")
	store.DB.Exec("INSERT INTO projects (id, name, path) VALUES (2, 'test2', '/tmp/test2')")
	t.Cleanup(func() { store.Close() })
	return store, pty.NewManager()
}

func TestManagerSpawnAndList(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	agent, err := mgr.Spawn(1, "custom", "test task", "/tmp", "echo hello")
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}
	if agent.ID == "" {
		t.Error("expected non-empty agent ID")
	}
	if agent.Status != AgentStatusStarting {
		t.Errorf("expected starting, got %s", agent.Status)
	}

	agents := mgr.List()
	if len(agents) != 1 {
		t.Errorf("expected 1 agent, got %d", len(agents))
	}

	time.Sleep(500 * time.Millisecond)

	got := mgr.Get(agent.ID)
	if got == nil {
		t.Fatal("expected agent to exist after exit")
	}
	if got.Status != AgentStatusDone {
		t.Errorf("expected done after exit, got %s", got.Status)
	}
}

func TestManagerSpawnCommandNotFound(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	_, err := mgr.Spawn(1, "custom", "test", "/tmp", "nonexistent_command_xyz")
	if err == nil {
		t.Error("expected error for nonexistent command")
	}
}

func TestManagerStop(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	agent, err := mgr.Spawn(1, "custom", "long task", "/tmp", "sleep 60")
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}

	err = mgr.Stop(agent.ID)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	got := mgr.Get(agent.ID)
	if got == nil {
		t.Fatal("agent should exist after stop")
	}
	if got.Status != AgentStatusError && got.Status != AgentStatusDone {
		t.Errorf("expected done or error after stop, got %s", got.Status)
	}
}

func TestManagerListByProject(t *testing.T) {
	store, ptyMgr := setupTestEnv(t)
	mgr := NewManager(ptyMgr, store, func(data []byte) {})

	mgr.Spawn(1, "custom", "task 1", "/tmp", "echo a")
	mgr.Spawn(2, "custom", "task 2", "/tmp", "echo b")
	mgr.Spawn(1, "custom", "task 3", "/tmp", "echo c")

	proj1 := mgr.ListByProject(1)
	if len(proj1) != 2 {
		t.Errorf("expected 2 agents for project 1, got %d", len(proj1))
	}
}
