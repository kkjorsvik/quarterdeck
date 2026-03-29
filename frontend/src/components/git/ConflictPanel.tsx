import React, { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';

interface ConflictPanelProps {
  projectId: number;
}

export function ConflictPanel({ projectId }: ConflictPanelProps) {
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshGitStatus = useProjectStore(s => s.refreshGitStatus);

  const loadConflicts = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const files: string[] = await (window as any).go.main.App.ListConflictFiles(projectId);
      setConflictFiles(files || []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  const handleMarkResolved = useCallback(async (filePath: string) => {
    try {
      await (window as any).go.main.App.MarkFileResolved(projectId, filePath);
      setResolvedFiles(prev => new Set(prev).add(filePath));
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, [projectId]);

  const handleCompleteMerge = useCallback(async () => {
    try {
      setError('');
      await (window as any).go.main.App.CompleteMerge(projectId);
      await refreshGitStatus();
      setConflictFiles([]);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, [projectId, refreshGitStatus]);

  const handleAbortMerge = useCallback(async () => {
    if (!window.confirm('Abort the current merge? All merge progress will be lost.')) return;
    try {
      setError('');
      await (window as any).go.main.App.AbortMerge(projectId);
      await refreshGitStatus();
      setConflictFiles([]);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, [projectId, refreshGitStatus]);

  const allResolved = conflictFiles.length > 0 && conflictFiles.every(f => resolvedFiles.has(f));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>
          Merge Conflicts {conflictFiles.length > 0 ? `\u2014 ${conflictFiles.length} file${conflictFiles.length !== 1 ? 's' : ''}` : ''}
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={handleCompleteMerge}
            disabled={!allResolved}
            style={{
              ...btnStyle,
              background: allResolved ? '#34d399' : 'var(--bg-secondary)',
              color: allResolved ? '#000' : 'var(--text-secondary)',
              opacity: allResolved ? 1 : 0.5,
            }}
          >
            Complete Merge
          </button>
          <button onClick={handleAbortMerge} style={{ ...btnStyle, color: '#f87171' }}>
            Abort Merge
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '6px 16px', fontSize: '12px', color: '#f87171' }}>{error}</div>
      )}

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {loading && <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>Loading...</div>}

        {conflictFiles.map(file => {
          const isResolved = resolvedFiles.has(file);
          const filename = file.split('/').pop() || file;
          return (
            <div
              key={file}
              style={{
                padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '13px',
                opacity: isResolved ? 0.5 : 1,
              }}
            >
              <span style={{ color: isResolved ? '#34d399' : '#f87171', fontWeight: 700, fontSize: '12px', width: '14px' }}>
                {isResolved ? '\u2713' : '!'}
              </span>
              <span
                style={{ flex: 1 }}
                title={file}
              >
                {filename}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                {file}
              </span>
              {!isResolved && (
                <button onClick={() => handleMarkResolved(file)} style={btnStyle}>
                  Mark Resolved
                </button>
              )}
            </div>
          );
        })}

        {!loading && conflictFiles.length === 0 && (
          <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>
            No merge conflicts
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  padding: '3px 10px',
  fontSize: '11px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
