package activity

import (
	"database/sql"
	"encoding/json"
	"time"
)

type Event struct {
	ID        int64     `json:"id"`
	EventType string    `json:"eventType"`
	AgentID   string    `json:"agentId"`
	ProjectID int64     `json:"projectId"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}

type Service struct {
	db        *sql.DB
	broadcast func([]byte)
}

func NewService(db *sql.DB, broadcast func([]byte)) *Service {
	return &Service{db: db, broadcast: broadcast}
}

func (s *Service) Record(eventType, agentID string, projectID int64, title, detail string) error {
	res, err := s.db.Exec(
		`INSERT INTO activity_events (event_type, agent_id, project_id, title, detail) VALUES (?, ?, ?, ?, ?)`,
		eventType, agentID, projectID, title, detail,
	)
	if err != nil {
		return err
	}

	id, _ := res.LastInsertId()
	evt := Event{
		ID:        id,
		EventType: eventType,
		AgentID:   agentID,
		ProjectID: projectID,
		Title:     title,
		Detail:    detail,
		CreatedAt: time.Now(),
	}

	wrapper := map[string]interface{}{
		"type":  "activity",
		"event": evt,
	}
	data, err := json.Marshal(wrapper)
	if err == nil && s.broadcast != nil {
		s.broadcast(data)
	}

	return nil
}

func (s *Service) RecordStateTransition(agentID, fromState, toState string) error {
	_, err := s.db.Exec(
		`INSERT INTO agent_state_transitions (agent_id, from_state, to_state) VALUES (?, ?, ?)`,
		agentID, fromState, toState,
	)
	return err
}

func (s *Service) List(limit, offset int) ([]Event, error) {
	rows, err := s.db.Query(
		`SELECT id, event_type, agent_id, project_id, title, detail, created_at
		 FROM activity_events ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEvents(rows)
}

func (s *Service) ListByProject(projectID int64, limit int) ([]Event, error) {
	rows, err := s.db.Query(
		`SELECT id, event_type, agent_id, project_id, title, detail, created_at
		 FROM activity_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
		projectID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEvents(rows)
}

func (s *Service) GetStateHistory(agentID string) ([]map[string]string, error) {
	rows, err := s.db.Query(
		`SELECT agent_id, from_state, to_state, created_at
		 FROM agent_state_transitions WHERE agent_id = ? ORDER BY created_at ASC`,
		agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]string
	for rows.Next() {
		var aid, from, to, createdAt string
		if err := rows.Scan(&aid, &from, &to, &createdAt); err != nil {
			return nil, err
		}
		result = append(result, map[string]string{
			"agentId":   aid,
			"fromState": from,
			"toState":   to,
			"createdAt": createdAt,
		})
	}
	return result, rows.Err()
}

func scanEvents(rows *sql.Rows) ([]Event, error) {
	var events []Event
	for rows.Next() {
		var e Event
		var agentID sql.NullString
		var projectID sql.NullInt64
		var detail sql.NullString
		if err := rows.Scan(&e.ID, &e.EventType, &agentID, &projectID, &e.Title, &detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		if agentID.Valid {
			e.AgentID = agentID.String
		}
		if projectID.Valid {
			e.ProjectID = projectID.Int64
		}
		if detail.Valid {
			e.Detail = detail.String
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
