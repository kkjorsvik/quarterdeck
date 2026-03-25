package project

import (
	"fmt"
	"strings"
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
	SortOrder        int    `json:"sortOrder"`
	Color            string `json:"color"`
	Notes            string `json:"notes"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type UpdateFields struct {
	Name             *string
	Path             *string
	GitDefaultBranch *string
	DevServerURL     *string
	DevServerCommand *string
	DefaultAgentType *string
	SortOrder        *int
	Color            *string
	Notes            *string
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
		"SELECT id, name, path, COALESCE(git_default_branch,'main'), COALESCE(dev_server_url,''), COALESCE(dev_server_command,''), COALESCE(default_agent_type,''), COALESCE(sort_order,0), COALESCE(color,''), COALESCE(notes,''), created_at, updated_at FROM projects ORDER BY sort_order, name",
	)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Path, &p.GitDefaultBranch, &p.DevServerURL, &p.DevServerCommand, &p.DefaultAgentType, &p.SortOrder, &p.Color, &p.Notes, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Service) Get(id int64) (*Project, error) {
	var p Project
	err := s.store.DB.QueryRow(
		"SELECT id, name, path, COALESCE(git_default_branch,'main'), COALESCE(dev_server_url,''), COALESCE(dev_server_command,''), COALESCE(default_agent_type,''), COALESCE(sort_order,0), COALESCE(color,''), COALESCE(notes,''), created_at, updated_at FROM projects WHERE id = ?",
		id,
	).Scan(&p.ID, &p.Name, &p.Path, &p.GitDefaultBranch, &p.DevServerURL, &p.DevServerCommand, &p.DefaultAgentType, &p.SortOrder, &p.Color, &p.Notes, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get project %d: %w", id, err)
	}
	return &p, nil
}

func (s *Service) Update(id int64, fields UpdateFields) error {
	var sets []string
	var args []interface{}

	if fields.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *fields.Name)
	}
	if fields.Path != nil {
		sets = append(sets, "path = ?")
		args = append(args, *fields.Path)
	}
	if fields.GitDefaultBranch != nil {
		sets = append(sets, "git_default_branch = ?")
		args = append(args, *fields.GitDefaultBranch)
	}
	if fields.DevServerURL != nil {
		sets = append(sets, "dev_server_url = ?")
		args = append(args, *fields.DevServerURL)
	}
	if fields.DevServerCommand != nil {
		sets = append(sets, "dev_server_command = ?")
		args = append(args, *fields.DevServerCommand)
	}
	if fields.DefaultAgentType != nil {
		sets = append(sets, "default_agent_type = ?")
		args = append(args, *fields.DefaultAgentType)
	}
	if fields.SortOrder != nil {
		sets = append(sets, "sort_order = ?")
		args = append(args, *fields.SortOrder)
	}
	if fields.Color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *fields.Color)
	}
	if fields.Notes != nil {
		sets = append(sets, "notes = ?")
		args = append(args, *fields.Notes)
	}

	if len(sets) == 0 {
		return nil
	}

	sets = append(sets, "updated_at = ?")
	args = append(args, time.Now().UTC().Format(time.RFC3339))
	args = append(args, id)

	query := fmt.Sprintf("UPDATE projects SET %s WHERE id = ?", strings.Join(sets, ", "))
	_, err := s.store.DB.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("update project %d: %w", id, err)
	}
	return nil
}

func (s *Service) Delete(id int64) error {
	_, err := s.store.DB.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete project %d: %w", id, err)
	}
	return nil
}
