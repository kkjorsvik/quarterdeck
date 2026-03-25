package filetree

import (
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
    "strings"
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

var skipDirs = map[string]bool{
    "node_modules": true, ".git": true, "build": true, "dist": true,
    "__pycache__": true, ".next": true, "target": true, "vendor": true,
}

func (s *Service) ReadDirFiltered(dirPath string) ([]FileEntry, error) {
    dirEntries, err := os.ReadDir(dirPath)
    if err != nil {
        return nil, fmt.Errorf("read dir %s: %w", dirPath, err)
    }

    var candidates []FileEntry
    for _, de := range dirEntries {
        name := de.Name()
        if len(name) > 0 && name[0] == '.' {
            continue
        }
        if de.IsDir() && skipDirs[name] {
            continue
        }
        info, err := de.Info()
        if err != nil {
            continue
        }
        candidates = append(candidates, FileEntry{
            Name:  name,
            Path:  filepath.Join(dirPath, name),
            IsDir: de.IsDir(),
            Size:  info.Size(),
        })
    }

    candidates = filterGitIgnored(dirPath, candidates)

    sort.Slice(candidates, func(i, j int) bool {
        if candidates[i].IsDir != candidates[j].IsDir {
            return candidates[i].IsDir
        }
        return candidates[i].Name < candidates[j].Name
    })

    return candidates, nil
}

func filterGitIgnored(dirPath string, entries []FileEntry) []FileEntry {
    if len(entries) == 0 {
        return entries
    }

    cmd := exec.Command("git", "-C", dirPath, "rev-parse", "--git-dir")
    if err := cmd.Run(); err != nil {
        return entries
    }

    var paths []string
    for _, e := range entries {
        paths = append(paths, e.Path)
    }

    cmd = exec.Command("git", "-C", dirPath, "check-ignore", "--stdin")
    cmd.Stdin = strings.NewReader(strings.Join(paths, "\n"))
    out, _ := cmd.Output()

    ignored := make(map[string]bool)
    for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
        if line != "" {
            ignored[line] = true
        }
    }

    var filtered []FileEntry
    for _, e := range entries {
        if !ignored[e.Path] {
            filtered = append(filtered, e)
        }
    }
    return filtered
}

func (s *Service) ListFiles(rootPath string) ([]string, error) {
	var files []string
	err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		name := info.Name()
		if info.IsDir() {
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "__pycache__" || name == "target" || name == "dist" || name == "build" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") {
			return nil
		}
		rel, _ := filepath.Rel(rootPath, path)
		files = append(files, rel)
		return nil
	})
	return files, err
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
