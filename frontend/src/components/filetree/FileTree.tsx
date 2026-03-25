import React, { useEffect, useState } from 'react';
import type { FileEntry } from '../../lib/types';
import { FileNode } from './FileNode';

interface FileTreeProps {
  rootPath: string;
}

export function FileTree({ rootPath }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDir() {
      setLoading(true);
      try {
        const result = await window.go.main.App.ReadDirFiltered(rootPath);
        if (!cancelled) {
          setEntries(result || []);
        }
      } catch (err) {
        console.error('Failed to load file tree:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDir();
    return () => { cancelled = true; };
  }, [rootPath]);

  if (loading) {
    return (
      <div style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        Loading…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        Empty directory
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {entries.map(entry => (
        <FileNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}
