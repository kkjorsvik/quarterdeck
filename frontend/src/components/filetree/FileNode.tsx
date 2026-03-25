import React, { useState, useCallback } from 'react';
import type { FileEntry } from '../../lib/types';
import { useEditorStore } from '../../stores/editorStore';
import { useLayoutStore } from '../../stores/layoutStore';

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    ts: 'TS', tsx: 'TX', js: 'JS', jsx: 'JX', go: 'GO', py: 'PY',
    rs: 'RS', json: '{}', yaml: 'YM', yml: 'YM', toml: 'TM',
    md: 'MD', html: '<>', css: '#', sql: 'SQ', sh: '$',
    mod: 'GO', sum: 'GO', lock: 'LK',
  };
  return icons[ext] || '--';
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
}

export function FileNode({ entry, depth }: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const openFile = useEditorStore(s => s.openFile);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const addTab = useLayoutStore(s => s.addTab);
  const setActiveTab = useLayoutStore(s => s.setActiveTab);
  const getLeafById = useLayoutStore(s => s.getLeafById);

  const toggleDir = useCallback(async () => {
    if (!entry.isDir) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    setLoading(true);
    try {
      const entries = await window.go.main.App.ReadDirFiltered(entry.path);
      setChildren(entries || []);
      setExpanded(true);
    } catch (err) {
      console.error('Failed to read dir:', err);
    } finally {
      setLoading(false);
    }
  }, [entry, expanded]);

  const handleFileClick = useCallback(async () => {
    if (entry.isDir) {
      toggleDir();
      return;
    }

    try {
      const content = await window.go.main.App.ReadFile(entry.path);
      openFile(entry.path, content);

      // Check if file is already open in a tab
      const leaf = getLeafById(focusedPaneId);
      if (leaf) {
        const existingIdx = leaf.tabs.findIndex(t => t.filePath === entry.path);
        if (existingIdx >= 0) {
          setActiveTab(focusedPaneId, existingIdx);
          return;
        }
      }

      const filename = entry.path.split('/').pop() || entry.path;
      addTab(focusedPaneId, { type: 'editor', title: filename, filePath: entry.path });
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }, [entry, openFile, focusedPaneId, addTab, setActiveTab, getLeafById, toggleDir]);

  return (
    <div>
      <div
        onClick={handleFileClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '2px 8px',
          paddingLeft: `${depth * 16 + 8}px`,
          cursor: 'pointer',
          fontSize: '13px',
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ marginRight: '6px', fontSize: '11px', width: '14px', display: 'inline-block' }}>
          {entry.isDir ? (expanded ? '▼' : '▶') : (
            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              {fileIcon(entry.name)}
            </span>
          )}
        </span>
        <span>{entry.name}</span>
        {loading && <span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>…</span>}
      </div>
      {expanded && children.map(child => (
        <FileNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  );
}
