package ws

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type EventHub struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]bool
}

func NewEventHub() *EventHub {
	return &EventHub{conns: make(map[*websocket.Conn]bool)}
}

func (h *EventHub) Add(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[conn] = true
}

func (h *EventHub) Remove(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	conn.Close()
	delete(h.conns, conn)
}

// Broadcast sends a message to all connected event listeners.
// Uses full Lock because gorilla/websocket does not support concurrent writes.
func (h *EventHub) Broadcast(data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.conns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("event broadcast error: %v", err)
		}
	}
}

func (h *EventHub) HandleEvents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("event ws upgrade failed: %v", err)
			return
		}
		h.Add(conn)
		defer h.Remove(conn)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
		}
	}
}

// DetectorLookup allows the WS handler to find detectors without importing agent package.
type DetectorLookup interface {
	FeedDetector(ptySessionID string, data []byte)
}
