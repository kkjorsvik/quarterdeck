import React, { useState, useCallback, useMemo } from 'react';
import type { FileEntry } from '../../lib/types';
import { useProjectStore } from '../../stores/projectStore';

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

function getGitIndicator(status: string | undefined, isStaged: boolean | undefined) {
  if (!status) return null;
  switch (status) {
    case 'modified':
      return isStaged
        ? { symbol: '\u2022', color: '#34d399', title: 'Staged' }
        : { symbol: '\u2022', color: '#fb923c', title: 'Modified' };
    case 'staged':
      return { symbol: '\u2022', color: '#34d399', title: 'Staged' };
    case 'untracked':
      return { symbol: 'U', color: '#6b7280', title: 'Untracked' };
    case 'deleted':
      return { symbol: '\u2022', color: '#f87171', title: 'Deleted', strikethrough: true };
    case 'conflicted':
      return { symbol: '!', color: '#f87171', title: 'Conflicted' };
    case 'renamed':
      return { symbol: '\u2022', color: '#60a5fa', title: 'Renamed' };
    default:
      return null;
  }
}

// Priority for directory aggregation: conflicted > deleted > modified > staged > renamed > untracked
const STATUS_PRIORITY: Record<string, number> = {
  conflicted: 6, deleted: 5, modified: 4, staged: 3, renamed: 2, untracked: 1,
};

export function FileNode({ entry, depth }: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const gitStatusMap = useProjectStore(s => s.gitStatusMap);
  const projectPath = useProjectStore(s => {
    const proj = s.projects.find(p => p.id === s.activeProjectId);
    return proj?.path || '';
  });

  // Compute git status for this entry
  const relativePath = projectPath ? entry.path.replace(projectPath + '/', '') : '';
  const fileStatus = gitStatusMap.get(relativePath);

  // For directories: find the most urgent child status
  const dirIndicator = useMemo(() => {
    if (!entry.isDir || !expanded) return null;
    let bestStatus = '';
    let bestStaged = false;
    let bestPriority = 0;
    gitStatusMap.forEach((fs, path) => {
      if (path.startsWith(relativePath + '/') || relativePath === '') {
        const p = STATUS_PRIORITY[fs.status] || 0;
        if (p > bestPriority) {
          bestPriority = p;
          bestStatus = fs.status;
          bestStaged = fs.isStaged;
        }
      }
    });
    return bestPriority > 0 ? getGitIndicator(bestStatus, bestStaged) : null;
  }, [entry.isDir, expanded, gitStatusMap, relativePath]);

  const indicator = entry.isDir ? dirIndicator : getGitIndicator(fileStatus?.status, fileStatus?.isStaged);
  const isDeleted = fileStatus?.status === 'deleted' && !entry.isDir;

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

    // File opening is no longer supported — will be removed in Task 2
    console.warn('File open not supported:', entry.path);
  }, [entry, toggleDir]);

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
        <span style={isDeleted ? { textDecoration: 'line-through', color: '#f87171' } : undefined}>{entry.name}</span>
        {indicator && (
          <span
            title={indicator.title}
            style={{
              marginLeft: '4px',
              fontSize: indicator.symbol.length === 1 && indicator.symbol !== 'U' && indicator.symbol !== '!' ? '14px' : '10px',
              fontWeight: 700,
              color: indicator.color,
              lineHeight: 1,
              fontFamily: indicator.symbol === 'U' || indicator.symbol === '!' ? 'monospace' : 'inherit',
            }}
          >
            {indicator.symbol}
          </span>
        )}
        {loading && <span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>…</span>}
      </div>
      {expanded && children.map(child => (
        <FileNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  );
}
