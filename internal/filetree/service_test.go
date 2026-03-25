package filetree

import (
    "os"
    "path/filepath"
    "testing"
)

func TestReadDir(t *testing.T) {
    dir := t.TempDir()
    os.WriteFile(filepath.Join(dir, "hello.go"), []byte("package main"), 0644)
    os.Mkdir(filepath.Join(dir, "subdir"), 0755)
    os.WriteFile(filepath.Join(dir, "subdir", "nested.go"), []byte("package sub"), 0644)

    svc := NewService()
    entries, err := svc.ReadDir(dir)
    if err != nil {
        t.Fatalf("ReadDir failed: %v", err)
    }

    if len(entries) != 2 {
        t.Fatalf("expected 2 entries, got %d", len(entries))
    }

    // Directories sort before files
    if entries[0].Name != "subdir" || !entries[0].IsDir {
        t.Errorf("expected first entry to be 'subdir' dir, got %+v", entries[0])
    }
    if entries[1].Name != "hello.go" || entries[1].IsDir {
        t.Errorf("expected second entry to be 'hello.go' file, got %+v", entries[1])
    }
}

func TestReadFile(t *testing.T) {
    dir := t.TempDir()
    content := "package main\n\nfunc main() {}\n"
    os.WriteFile(filepath.Join(dir, "main.go"), []byte(content), 0644)

    svc := NewService()
    got, err := svc.ReadFile(filepath.Join(dir, "main.go"))
    if err != nil {
        t.Fatalf("ReadFile failed: %v", err)
    }
    if got != content {
        t.Errorf("content mismatch: got %q", got)
    }
}

func TestReadDirFiltered(t *testing.T) {
    dir := t.TempDir()
    os.Mkdir(filepath.Join(dir, "node_modules"), 0755)
    os.Mkdir(filepath.Join(dir, ".git"), 0755)
    os.Mkdir(filepath.Join(dir, "src"), 0755)
    os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0644)

    svc := NewService()
    entries, err := svc.ReadDirFiltered(dir)
    if err != nil {
        t.Fatalf("ReadDirFiltered failed: %v", err)
    }

    if len(entries) != 2 {
        t.Fatalf("expected 2 entries, got %d: %+v", len(entries), entries)
    }
    if entries[0].Name != "src" {
        t.Errorf("expected first entry 'src', got %q", entries[0].Name)
    }
    if entries[1].Name != "main.go" {
        t.Errorf("expected second entry 'main.go', got %q", entries[1].Name)
    }
}

func TestWriteFile(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "output.txt")

    svc := NewService()
    err := svc.WriteFile(path, "hello world")
    if err != nil {
        t.Fatalf("WriteFile failed: %v", err)
    }

    data, _ := os.ReadFile(path)
    if string(data) != "hello world" {
        t.Errorf("expected 'hello world', got %q", string(data))
    }
}
