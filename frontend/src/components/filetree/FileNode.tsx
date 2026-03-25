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
  const removeTab = useLayoutStore(s => s.removeTab);
  const setActiveTab = useLayoutStore(s => s.setActiveTab);
  const getLeafById = useLayoutStore(s => s.getLeafById);
  const getEditorPaneId = useLayoutStore(s => s.getEditorPaneId);

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

      // Target the editor pane if one exists, otherwise fall back to focused pane
      const targetPaneId = getEditorPaneId() || focusedPaneId;

      // Check if file is already open in a tab in the target pane
      const leaf = getLeafById(targetPaneId);
      if (leaf) {
        const existingIdx = leaf.tabs.findIndex(t => t.filePath === entry.path);
        if (existingIdx >= 0) {
          setActiveTab(targetPaneId, existingIdx);
          return;
        }
      }

      const filename = entry.path.split('/').pop() || entry.path;
      addTab(targetPaneId, { type: 'editor', title: filename, filePath: entry.path });

      // Close any empty editor placeholder tabs (no filePath)
      const updatedLeaf = getLeafById(targetPaneId);
      if (updatedLeaf) {
        for (let i = updatedLeaf.tabs.length - 1; i >= 0; i--) {
          if (updatedLeaf.tabs[i].type === 'editor' && !updatedLeaf.tabs[i].filePath) {
            removeTab(targetPaneId, i);
            break;
          }
        }
      }
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }, [entry, openFile, focusedPaneId, addTab, removeTab, setActiveTab, getLeafById, getEditorPaneId, toggleDir]);

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
