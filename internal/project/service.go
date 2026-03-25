package project

import (
	"fmt"
	"time"

	"github.com/kkjorsvik/quarterdeck/internal/db"
)

type Project struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Path             string `json:"path"`
	GitDefaultBranch string `json:"gitDefaultBranch"`
	DevServerURL     string `json:"devServerUrl"`
	DevServerCommand string `json:"devServerCommand"`
	DefaultAgentType string `json:"defaultAgentType"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type Service struct {
	store *db.Store
}

func NewService(store *db.Store) *Service {
	return &Service{store: store}
}

func (s *Service) Add(name, path string) (*Project, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.store.DB.Exec(
		"INSERT INTO projects (name, path, created_at, updated_at) VALUES (?, ?, ?, ?)",
		name, path, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert project: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get last insert id: %w", err)
	}

	return &Project{ID: id, Name: name, Path: path, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Service) List() ([]Project, error) {
	rows, err := s.store.DB.Query(
		"SELECT id, name, path, COALESCE(git_default_branch,'main'), COALESCE(dev_server_url,''), COALESCE(dev_server_command,''), COALESCE(default_agent_type,''), created_at, updated_at FROM projects ORDER BY name",
	)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Path, &p.GitDefaultBranch, &p.DevServerURL, &p.DevServerCommand, &p.DefaultAgentType, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Service) Get(id int64) (*Project, error) {
	var p Project
	err := s.store.DB.QueryRow(
		"SELECT id, name, path, COALESCE(git_default_branch,'main'), COALESCE(dev_server_url,''), COALESCE(dev_server_command,''), COALESCE(default_agent_type,''), created_at, updated_at FROM projects WHERE id = ?",
		id,
	).Scan(&p.ID, &p.Name, &p.Path, &p.GitDefaultBranch, &p.DevServerURL, &p.DevServerCommand, &p.DefaultAgentType, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get project %d: %w", id, err)
	}
	return &p, nil
}

func (s *Service) Delete(id int64) error {
	_, err := s.store.DB.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete project %d: %w", id, err)
	}
	return nil
}
