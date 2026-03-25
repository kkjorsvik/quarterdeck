package ws

import (
	"fmt"
	"log"
	"net"
	"net/http"

	ptyPkg "github.com/kkjorsvik/quarterdeck/internal/pty"
)

type Server struct {
	hub      *Hub
	ptyMgr   *ptyPkg.Manager
	listener net.Listener
	port     int
}

func NewServer(ptyMgr *ptyPkg.Manager) (*Server, error) {
	hub := NewHub()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/pty/", HandlePTY(hub, ptyMgr))

	srv := &Server{
		hub:      hub,
		ptyMgr:   ptyMgr,
		listener: listener,
		port:     port,
	}

	go func() {
		if err := http.Serve(listener, mux); err != nil {
			log.Printf("ws server closed: %v", err)
		}
	}()

	return srv, nil
}

func (s *Server) Port() int {
	return s.port
}

func (s *Server) Close() error {
	return s.listener.Close()
}
