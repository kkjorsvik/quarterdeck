CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    git_default_branch TEXT DEFAULT 'main',
    dev_server_url TEXT,
    dev_server_command TEXT,
    default_agent_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    task_description TEXT,
    base_commit TEXT,
    end_commit TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    pty_scrollback TEXT
);

CREATE TABLE IF NOT EXISTS run_file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL,
    diff_text TEXT,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pty_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    session_type TEXT NOT NULL,
    agent_type TEXT,
    command TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    exit_code INTEGER
);

CREATE TABLE IF NOT EXISTS layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'default',
    layout_json TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('external_editor', 'nvim'),
    ('theme', 'dark'),
    ('font_family', 'JetBrains Mono'),
    ('font_size', '14'),
    ('vim_mode', 'true'),
    ('notification_on_agent_complete', 'true'),
    ('notification_on_agent_error', 'true');

CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_run_file_changes_run ON run_file_changes(run_id);
CREATE INDEX IF NOT EXISTS idx_pty_sessions_project ON pty_sessions(project_id);
