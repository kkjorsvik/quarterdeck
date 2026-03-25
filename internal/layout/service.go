package layout

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

type Service struct {
	store *db.Store
}

func NewService(store *db.Store) *Service {
	return &Service{store: store}
}

func (s *Service) Save(projectID int64, layoutJSON string) error {
	now := time.Now().UTC().Format(time.RFC3339)

	// Use a two-step upsert since the unique index on project_id is partial
	// (WHERE project_id IS NOT NULL) and ON CONFLICT doesn't support partial indexes.
	result, err := s.store.DB.Exec(
		"UPDATE layouts SET layout_json = ?, updated_at = ? WHERE project_id = ?",
		layoutJSON, now, projectID,
	)
	if err != nil {
		return fmt.Errorf("save layout for project %d: %w", projectID, err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("save layout for project %d: %w", projectID, err)
	}

	if rows == 0 {
		_, err = s.store.DB.Exec(
			"INSERT INTO layouts (project_id, layout_json, updated_at) VALUES (?, ?, ?)",
			projectID, layoutJSON, now,
		)
		if err != nil {
			return fmt.Errorf("save layout for project %d: %w", projectID, err)
		}
	}

	return nil
}

func (s *Service) Get(projectID int64) (string, error) {
	var json string
	err := s.store.DB.QueryRow(
		"SELECT layout_json FROM layouts WHERE project_id = ?", projectID,
	).Scan(&json)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get layout for project %d: %w", projectID, err)
	}
	return json, nil
}

func (s *Service) GetAll() (map[int64]string, error) {
	rows, err := s.store.DB.Query(
		"SELECT project_id, layout_json FROM layouts WHERE project_id IS NOT NULL",
	)
	if err != nil {
		return nil, fmt.Errorf("query layouts: %w", err)
	}
	defer rows.Close()

	result := make(map[int64]string)
	for rows.Next() {
		var id int64
		var json string
		if err := rows.Scan(&id, &json); err != nil {
			return nil, fmt.Errorf("scan layout: %w", err)
		}
		result[id] = json
	}
	return result, rows.Err()
}

func (s *Service) Delete(projectID int64) error {
	_, err := s.store.DB.Exec("DELETE FROM layouts WHERE project_id = ?", projectID)
	if err != nil {
		return fmt.Errorf("delete layout for project %d: %w", projectID, err)
	}
	return nil
}
