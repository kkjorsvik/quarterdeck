package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu    sync.RWMutex
	conns map[string]*websocket.Conn
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[string]*websocket.Conn),
	}
}

func (h *Hub) Add(sessionID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[sessionID] = conn
}

func (h *Hub) Remove(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if conn, ok := h.conns[sessionID]; ok {
		conn.Close()
		delete(h.conns, sessionID)
	}
}

func (h *Hub) Get(sessionID string) (*websocket.Conn, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conn, ok := h.conns[sessionID]
	return conn, ok
}
