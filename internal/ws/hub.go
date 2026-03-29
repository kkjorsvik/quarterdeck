package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[*websocket.Conn]bool // sessionID → set of connections
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[string]map[*websocket.Conn]bool),
	}
}

func (h *Hub) Add(sessionID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[sessionID] == nil {
		h.conns[sessionID] = make(map[*websocket.Conn]bool)
	}
	h.conns[sessionID][conn] = true
}

func (h *Hub) Remove(sessionID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.conns[sessionID]; ok {
		conn.Close()
		delete(set, conn)
		if len(set) == 0 {
			delete(h.conns, sessionID)
		}
	}
}

func (h *Hub) GetAll(sessionID string) []*websocket.Conn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set := h.conns[sessionID]
	if len(set) == 0 {
		return nil
	}
	out := make([]*websocket.Conn, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	return out
}

func (h *Hub) Broadcast(sessionID string, msg []byte, msgType int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.conns[sessionID] {
		c.WriteMessage(msgType, msg)
	}
}
