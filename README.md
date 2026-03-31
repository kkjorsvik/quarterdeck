# Quarterdeck
(Putting this on the back burner for now as I'm not sure about the idea at the moment, might come back to it later.)

A Linux-native IDE for the AI agent era. Built for developers who work across multiple projects simultaneously by delegating to AI coding agents.

Quarterdeck provides a unified workspace where you can spawn and monitor AI agents (Claude Code, Codex, OpenCode) across multiple projects, review their changes with a built-in diff viewer, and manage the full agent lifecycle from one place.

## Features

- **Multi-project workspace** — manage multiple codebases with per-project layout memory and instant project switching
- **Real terminal emulation** — full PTY-based terminals via xterm.js with WebGL rendering, background terminal persistence across project switches
- **Agent management** — spawn, monitor, and track AI coding agents with hybrid state detection (timing heuristics + regex) and desktop notifications via notify-send
- **Built-in code editor** — Monaco editor with vim keybindings, syntax highlighting, and tabbed editing
- **Diff & review** — review agent changes per-run with Monaco diff editor (side-by-side and inline), accept/reject per file, commit from review with pre-populated messages
- **Git integration** — worktree isolation for agents, branch management, merge conflict resolution, git status indicators in the file tree, git log, stash support
- **i3-inspired tiling** — keyboard-driven panel layout with splits, tabs, and focus management
- **Linux-native** — compiled Go binary with WebKitGTK, not Electron. ~45MB binary, minimal resource usage.

## Requirements

- Linux (developed and tested on Arch Linux with i3wm)
- Go 1.22+
- Node.js (LTS)
- [Wails v2](https://wails.io/docs/gettingstarted/installation)
- System dependencies:
  - `webkit2gtk-4.1`
  - `gtk3`
  - `libsoup3`
  - `gcc`
  - `pkg-config`

### Arch Linux

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libsoup3 gcc pkg-config
```

### Ubuntu/Debian

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev gcc pkg-config
```

## Building

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Development mode (hot reload)
wails dev

# Production build
wails build
# Binary output: build/bin/quarterdeck
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New terminal tab |
| `Ctrl+Shift+H` | Split horizontal |
| `Ctrl+Shift+V` | Split vertical |
| `Ctrl+Shift+W` | Close tab/panel |
| `Ctrl+Shift+P` | Project switcher |
| `Ctrl+P` | File search (active project) |
| `Ctrl+Shift+A` | Spawn agent |
| `Ctrl+Shift+D` | Run history / review diffs |
| `Ctrl+Shift+G` | Working tree changes |
| `Ctrl+Shift+B` | Branch management |
| `Ctrl+Shift+L` | Git log |
| `Ctrl+Shift+O` | Add project |
| `Ctrl+Tab` | Cycle tabs |

## Architecture

```
quarterdeck/
├── main.go                    # Wails app entry point
├── app.go                     # Wails-bound methods (Go <-> JS bridge)
├── internal/
│   ├── agent/                 # Agent lifecycle, state detection, patterns
│   ├── db/                    # SQLite with embedded migrations
│   ├── filetree/              # File tree service
│   ├── git/                   # Git CLI wrappers (status, branch, worktree, etc.)
│   ├── layout/                # Layout persistence
│   ├── project/               # Project CRUD
│   ├── pty/                   # PTY session management (creack/pty)
│   └── ws/                    # WebSocket server for PTY streaming + events
├── frontend/
│   ├── src/
│   │   ├── stores/            # Zustand state management
│   │   ├── components/        # React components
│   │   ├── hooks/             # Custom hooks (terminal, Monaco, keybindings)
│   │   └── lib/               # Types, utilities
│   └── wailsjs/               # Auto-generated Wails bindings
└── docs/superpowers/          # Design specs and implementation plans
```

## Tech Stack

- **Backend:** Go + [Wails v2](https://wails.io)
- **Frontend:** React 18 + TypeScript + [Zustand](https://zustand-demo.pmnd.rs/)
- **Terminal:** [xterm.js](https://xtermjs.org/) with WebGL renderer
- **Editor:** [Monaco Editor](https://microsoft.github.io/monaco-editor/) with vim keybindings
- **Database:** SQLite via [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) (pure Go, no CGO)
- **PTY:** [creack/pty](https://github.com/creack/pty) for Unix pseudo-terminal allocation
- **Desktop:** WebKitGTK (no Electron)

## Status

This is a personal project built for my own workflow. It works on my machine (Arch Linux, i3wm, dual 1440p monitors). Issues and PRs welcome but I make no promises about supporting other configurations.

## License

MIT
