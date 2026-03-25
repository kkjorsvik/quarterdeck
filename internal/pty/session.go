package pty

import (
	"fmt"
	"os"
	"os/exec"

	cpty "github.com/creack/pty"
)

type Session struct {
	ID   string
	Cmd  *exec.Cmd
	File *os.File
}

func newSession(id, shell, workDir string, cols, rows uint16) (*Session, error) {
	cmd := exec.Command(shell)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := cpty.StartWithSize(cmd, &cpty.Winsize{
		Cols: cols,
		Rows: rows,
	})
	if err != nil {
		return nil, fmt.Errorf("start pty: %w", err)
	}

	return &Session{
		ID:   id,
		Cmd:  cmd,
		File: f,
	}, nil
}

func (s *Session) Read(buf []byte) (int, error) {
	return s.File.Read(buf)
}

func (s *Session) Write(data []byte) (int, error) {
	return s.File.Write(data)
}

func (s *Session) Resize(cols, rows uint16) error {
	return cpty.Setsize(s.File, &cpty.Winsize{Cols: cols, Rows: rows})
}

func (s *Session) Close() error {
	s.File.Close()
	if s.Cmd.Process != nil {
		s.Cmd.Process.Kill()
	}
	s.Cmd.Wait()
	return nil
}
