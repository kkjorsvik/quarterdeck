import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { fuzzyMatch } from '../../lib/fuzzyMatch';
import { OverlayContainer } from './OverlayContainer';

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

export function FileSearch() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const activeProject = useProjectStore(s => s.getActiveProject());
  const openFile = useEditorStore(s => s.openFile);
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = active === 'fileSearch';

  useEffect(() => {
    if (isOpen && activeProject) {
      setQuery('');
      setSelectedIndex(0);
      setLoading(true);
      window.go.main.App.ListProjectFiles(activeProject.path)
        .then((result: string[]) => {
          setFiles(result || []);
        })
        .catch(() => {
          setFiles([]);
        })
        .finally(() => {
          setLoading(false);
        });
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, activeProject?.path]);

  const filtered = useMemo(() => {
    const q = query.startsWith('#') ? query.slice(1) : query;
    if (!q.trim()) {
      return files.slice(0, 50).map(f => ({ path: f, matches: [] as number[] }));
    }
    const results: { path: string; matches: number[]; score: number }[] = [];
    for (const f of files) {
      const result = fuzzyMatch(q, f);
      if (result) {
        results.push({ path: f, matches: result.matches, score: result.score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 50);
  }, [files, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(async (relativePath: string) => {
    if (!activeProject) return;
    close();
    const fullPath = activeProject.path + '/' + relativePath;
    try {
      const content = await window.go.main.App.ReadFile(fullPath);
      openFile(fullPath, content);
      // Add editor tab to focused pane
      const name = relativePath.split('/').pop() || relativePath;
      addTab(focusedPaneId, { type: 'editor', title: name, filePath: fullPath });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [activeProject, close, openFile, addTab, focusedPaneId]);

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
        handleSelect(filtered[selectedIndex].path);
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
          width: '520px',
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
            placeholder={`Find file in ${activeProject?.name || 'project'}...`}
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

        {/* File list */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary, #888)', fontSize: '13px' }}>
              Loading files...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary, #888)', fontSize: '13px' }}>
              No matching files
            </div>
          )}
          {!loading && filtered.map((item, i) => {
            const isSelected = i === selectedIndex;
            const fileName = item.path.split('/').pop() || item.path;
            const dirPart = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';

            return (
              <div
                key={item.path}
                onClick={() => handleSelect(item.path)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 12px',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.05))' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: '13px', color: 'var(--text-primary, #ccc)',
                  }}>
                    {item.matches.length > 0 ? (
                      <HighlightedText text={item.path} matches={item.matches} />
                    ) : (
                      <>
                        <span>{fileName}</span>
                        {dirPart && (
                          <span style={{ color: 'var(--text-secondary, #888)', marginLeft: '8px', fontSize: '12px' }}>
                            {dirPart}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
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
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </OverlayContainer>
  );
}
