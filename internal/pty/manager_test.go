package pty

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestCreateAndCloseSession(t *testing.T) {
	mgr := NewManager()
	defer mgr.CloseAll()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	id, err := mgr.Create(shell, nil, "/tmp", 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if id == "" {
		t.Fatal("expected non-empty session ID")
	}

	sess, ok := mgr.Get(id)
	if !ok {
		t.Fatal("session not found after create")
	}
	if sess.ID != id {
		t.Errorf("session ID mismatch: %q vs %q", sess.ID, id)
	}

	sessions := mgr.List()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	err = mgr.Close(id)
	if err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	_, ok = mgr.Get(id)
	if ok {
		t.Error("session still found after close")
	}
}

func TestResizeSession(t *testing.T) {
	mgr := NewManager()
	defer mgr.CloseAll()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	id, err := mgr.Create(shell, nil, "/tmp", 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	err = mgr.Resize(id, 120, 40)
	if err != nil {
		t.Fatalf("Resize failed: %v", err)
	}
}

func TestReadFromSession(t *testing.T) {
	mgr := NewManager()
	defer mgr.CloseAll()

	id, err := mgr.Create("/bin/sh", nil, "/tmp", 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	sess, _ := mgr.Get(id)

	_, err = sess.Write([]byte("echo hello_pty_test\n"))
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	buf := make([]byte, 4096)
	var output string
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		n, err := sess.Read(buf)
		if err != nil {
			break
		}
		output += string(buf[:n])
		if strings.Contains(output, "hello_pty_test") {
			return
		}
	}
	t.Logf("output so far: %q", output)
	t.Fatal("did not see expected output 'hello_pty_test'")
}

func TestSessionExitDetection(t *testing.T) {
	mgr := NewManager()
	defer mgr.CloseAll()

	id, err := mgr.Create("/bin/sh", nil, "/tmp", 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	sess, _ := mgr.Get(id)
	sess.Write([]byte("exit 42\n"))

	select {
	case <-sess.Done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for session to exit")
	}

	if sess.ExitCode != 42 {
		t.Errorf("expected exit code 42, got %d", sess.ExitCode)
	}
}
