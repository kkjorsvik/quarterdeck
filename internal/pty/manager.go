package pty

import (
	"fmt"
	"sync"

	"github.com/google/uuid"
)

type SessionInfo struct {
	ID      string `json:"id"`
	Command string `json:"command"`
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) Create(command string, args []string, workDir string, cols, rows uint16) (string, error) {
	id := uuid.New().String()

	sess, err := newSession(id, command, args, workDir, cols, rows)
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}

	m.mu.Lock()
	m.sessions[id] = sess
	m.mu.Unlock()

	return id, nil
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[id]
	return sess, ok
}

func (m *Manager) List() []SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var infos []SessionInfo
	for _, sess := range m.sessions {
		infos = append(infos, SessionInfo{
			ID:      sess.ID,
			Command: sess.Cmd.Path,
		})
	}
	return infos
}

func (m *Manager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session %s not found", id)
	}
	return sess.Resize(cols, rows)
}

func (m *Manager) Close(id string) error {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session %s not found", id)
	}
	delete(m.sessions, id)
	m.mu.Unlock()
	return sess.Close()
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, sess := range m.sessions {
		sess.Close()
		delete(m.sessions, id)
	}
}
