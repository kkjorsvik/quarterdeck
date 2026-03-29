package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	ptyPkg "github.com/kkjorsvik/quarterdeck/internal/pty"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type controlMessage struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

type exitedMessage struct {
	Type     string `json:"type"`
	ExitCode int    `json:"exitCode"`
}

// PTYLogger writes PTY output to persistent storage.
type PTYLogger interface {
	Write(sessionID string, data []byte)
}

func HandlePTY(hub *Hub, ptyMgr *ptyPkg.Manager, detectorLookup DetectorLookup, logger PTYLogger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/ws/pty/"), "/")
		if len(parts) == 0 || parts[0] == "" {
			http.Error(w, "missing session ID", http.StatusBadRequest)
			return
		}
		sessionID := parts[0]

		sess, ok := ptyMgr.Get(sessionID)
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("websocket upgrade failed: %v", err)
			return
		}

		hub.Add(sessionID, conn)
		defer hub.Remove(sessionID, conn)

		// PTY -> WebSocket (write loop)
		go func() {
			buf := make([]byte, 8192)
			for {
				n, err := sess.Read(buf)
				if err != nil {
					break // EOF or PTY closed — normal end of session
				}
				if logger != nil {
					logger.Write(sessionID, buf[:n])
				}
				hub.Broadcast(sessionID, buf[:n], websocket.BinaryMessage)
				if detectorLookup != nil {
					detectorLookup.FeedDetector(sessionID, buf[:n])
				}
			}
			// Wait for process exit to get exit code
			select {
			case <-sess.Done:
				exitMsg := exitedMessage{Type: "exited", ExitCode: sess.ExitCode}
				data, _ := json.Marshal(exitMsg)
				hub.Broadcast(sessionID, data, websocket.TextMessage)
			case <-time.After(time.Second):
			}
			closeMsg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "")
			hub.Broadcast(sessionID, closeMsg, websocket.CloseMessage)
		}()

		// WebSocket -> PTY (read loop)
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			switch msgType {
			case websocket.BinaryMessage:
				sess.Write(data)
			case websocket.TextMessage:
				var msg controlMessage
				if err := json.Unmarshal(data, &msg); err != nil {
					continue
				}
				if msg.Type == "resize" {
					ptyMgr.Resize(sessionID, msg.Cols, msg.Rows)
				}
			}
		}
	}
}
