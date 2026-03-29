package pty

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Logger writes PTY output to disk for post-mortem review.
type Logger struct {
	mu      sync.Mutex
	writers map[string]*os.File
	logDir  string
}

// NewLogger creates a Logger that stores session logs under logDir.
func NewLogger(logDir string) (*Logger, error) {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}
	return &Logger{
		writers: make(map[string]*os.File),
		logDir:  logDir,
	}, nil
}

// StartLogging opens a log file for the given session.
func (l *Logger) StartLogging(sessionID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	path := filepath.Join(l.logDir, sessionID+".log")
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create log file: %w", err)
	}
	l.writers[sessionID] = f
	return nil
}

// Write appends data to the session's log file. No-op if not logging.
func (l *Logger) Write(sessionID string, data []byte) {
	l.mu.Lock()
	f, ok := l.writers[sessionID]
	l.mu.Unlock()
	if !ok {
		return
	}
	// Write is best-effort; ignore errors.
	f.Write(data)
}

// StopLogging closes the log file for the given session.
func (l *Logger) StopLogging(sessionID string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if f, ok := l.writers[sessionID]; ok {
		f.Close()
		delete(l.writers, sessionID)
	}
}

// ReadLog returns the full contents of a session's log file.
func (l *Logger) ReadLog(sessionID string) (string, error) {
	path := filepath.Join(l.logDir, sessionID+".log")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read log file: %w", err)
	}
	return string(data), nil
}

// CloseAll closes all open log files.
func (l *Logger) CloseAll() {
	l.mu.Lock()
	defer l.mu.Unlock()

	for id, f := range l.writers {
		f.Close()
		delete(l.writers, id)
	}
}
