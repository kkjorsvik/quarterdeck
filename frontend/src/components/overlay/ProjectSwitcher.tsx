import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useProjectStore } from '../../stores/projectStore';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import { useAgentStore } from '../../stores/agentStore';
import { fuzzyMatch } from '../../lib/fuzzyMatch';
import { getProjectColor } from '../../lib/projectColors';
import { OverlayContainer } from './OverlayContainer';

function abbreviatePath(path: string): string {
  const home = '/home/' + path.split('/')[2];
  if (path.startsWith(home)) {
    return '~' + path.slice(home.length);
  }
  return path;
}

function HighlightedText({ text, matches }: { text: string; matches: number[] }) {
  const matchSet = new Set(matches);
  return (
    <span>
      {text.split('').map((ch, i) => (
        <span key={i} style={matchSet.has(i) ? { color: 'var(--accent, #60a5fa)' } : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export function ProjectSwitcher() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const projects = useProjectStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const switchProject = useProjectStore(s => s.switchProject);
  const projectBranches = useProjectStore(s => s.projectBranches);
  const hasNewOutput = useBackgroundTerminalStore(s => s.hasNewOutput);
  const agents = useAgentStore(s => s.agents);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = active === 'projectSwitcher';

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return projects.map(p => ({ project: p, matches: [] as number[] }));
    }
    const results: { project: typeof projects[0]; matches: number[]; score: number }[] = [];
    for (const p of projects) {
      const result = fuzzyMatch(query, p.name);
      if (result) {
        results.push({ project: p, matches: result.matches, score: result.score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }, [projects, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(async (projectId: number) => {
    close();
    if (projectId !== activeProjectId) {
      await switchProject(projectId);
    }
  }, [close, activeProjectId, switchProject]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex].project.id);
      }
    }
  }, [close, filtered, selectedIndex, handleSelect]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <OverlayContainer>
      <div
        style={{
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '400px',
          background: 'var(--bg-secondary, #1e1e2e)',
          border: '1px solid var(--border, #333)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div style={{ padding: '8px', borderBottom: '1px solid var(--border, #333)' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Switch project..."
            style={{
              width: '100%',
              background: 'var(--bg-primary, #111)',
              border: '1px solid var(--border, #333)',
              borderRadius: '4px',
              padding: '8px 10px',
              color: 'var(--text-primary, #ccc)',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Project list */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary, #888)', fontSize: '13px' }}>
              No matching projects
            </div>
          )}
          {filtered.map((item, i) => {
            const p = item.project;
            const color = getProjectColor(p.sortOrder, p.color || null);
            const branch = projectBranches.get(p.id) || '';
            const isActive = p.id === activeProjectId;
            const isSelected = i === selectedIndex;
            const newOutput = hasNewOutput(p.id);

            return (
              <div
                key={p.id}
                onClick={() => handleSelect(p.id)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.05))' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent, #60a5fa)' : '2px solid transparent',
                }}
              >
                {/* Color dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: color, flexShrink: 0,
                }} />

                {/* Activity dot */}
                {newOutput && (
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#facc15', flexShrink: 0,
                  }} />
                )}

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', color: 'var(--text-primary, #ccc)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {item.matches.length > 0 ? (
                      <HighlightedText text={p.name} matches={item.matches} />
                    ) : (
                      p.name
                    )}
                  </div>
                  <div style={{
                    fontSize: '11px', color: 'var(--text-secondary, #888)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {abbreviatePath(p.path)}
                  </div>
                </div>

                {/* Branch */}
                {branch && (
                  <span style={{
                    fontSize: '11px', color: 'var(--text-secondary, #888)',
                    flexShrink: 0,
                  }}>
                    {branch}
                  </span>
                )}

                {/* Agent health summary */}
                {(() => {
                  const projectAgents = Array.from(agents.values()).filter(a => a.projectId === p.id);
                  if (projectAgents.length === 0) return null;
                  const running = projectAgents.filter(a => a.status === 'starting' || a.status === 'working').length;
                  const needsInput = projectAgents.filter(a => a.status === 'needs_input').length;
                  const errors = projectAgents.filter(a => a.status === 'error').length;
                  const done = projectAgents.filter(a => a.status === 'done').length;
                  return (
                    <span style={{
                      display: 'inline-flex', gap: '6px', fontSize: '11px', flexShrink: 0,
                    }}>
                      {running > 0 && <span style={{ color: '#34d399' }}>{running} running</span>}
                      {needsInput > 0 && <span style={{ color: '#facc15' }}>{needsInput} input</span>}
                      {errors > 0 && <span style={{ color: '#f87171' }}>{errors} error</span>}
                      {done > 0 && <span style={{ color: '#9ca3af' }}>{done} done</span>}
                    </span>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border, #333)',
          display: 'flex',
          gap: '12px',
          fontSize: '11px',
          color: 'var(--text-secondary, #666)',
        }}>
          <span>↑↓ navigate</span>
          <span>↵ switch</span>
          <span>esc close</span>
        </div>
      </div>
    </OverlayContainer>
  );
}
