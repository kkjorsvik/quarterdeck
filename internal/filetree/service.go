package filetree

import (
    "fmt"
    "os"
    "path/filepath"
    "sort"
)

type FileEntry struct {
    Name  string `json:"name"`
    Path  string `json:"path"`
    IsDir bool   `json:"isDir"`
    Size  int64  `json:"size"`
}

type Service struct{}

func NewService() *Service {
    return &Service{}
}

func (s *Service) ReadDir(dirPath string) ([]FileEntry, error) {
    dirEntries, err := os.ReadDir(dirPath)
    if err != nil {
        return nil, fmt.Errorf("read dir %s: %w", dirPath, err)
    }

    var entries []FileEntry
    for _, de := range dirEntries {
        if de.Name()[0] == '.' {
            continue
        }
        info, err := de.Info()
        if err != nil {
            continue
        }
        entries = append(entries, FileEntry{
            Name:  de.Name(),
            Path:  filepath.Join(dirPath, de.Name()),
            IsDir: de.IsDir(),
            Size:  info.Size(),
        })
    }

    sort.Slice(entries, func(i, j int) bool {
        if entries[i].IsDir != entries[j].IsDir {
            return entries[i].IsDir
        }
        return entries[i].Name < entries[j].Name
    })

    return entries, nil
}

func (s *Service) ReadFile(filePath string) (string, error) {
    data, err := os.ReadFile(filePath)
    if err != nil {
        return "", fmt.Errorf("read file %s: %w", filePath, err)
    }
    return string(data), nil
}

func (s *Service) WriteFile(filePath string, content string) error {
    if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
        return fmt.Errorf("create parent dirs: %w", err)
    }
    if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
        return fmt.Errorf("write file %s: %w", filePath, err)
    }
    return nil
}
