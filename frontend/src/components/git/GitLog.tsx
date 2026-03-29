import React, { useState, useEffect, useCallback } from 'react';
import type { CommitInfo, FileChange } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';

interface GitLogProps {
  projectId: number;
}

const PAGE_SIZE = 50;

function relativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function GitLog({ projectId }: GitLogProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);

  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const loadCommits = useCallback(async (offset: number, append: boolean) => {
    try {
      if (append) setLoadingMore(true); else setLoading(true);
      setError('');
      const result: CommitInfo[] = await (window as any).go.main.App.GetGitLog(projectId, PAGE_SIZE, offset);
      if (append) {
        setCommits(prev => [...prev, ...(result || [])]);
      } else {
        setCommits(result || []);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCommits(0, false);
  }, [loadCommits]);

  const handleLoadMore = useCallback(() => {
    loadCommits(commits.length, true);
  }, [loadCommits, commits.length]);

  const handleExpandCommit = useCallback(async (sha: string) => {
    if (expandedSha === sha) {
      setExpandedSha(null);
      return;
    }
    setExpandedSha(sha);
    setLoadingChanges(true);
    try {
      const changes: FileChange[] = await (window as any).go.main.App.GetCommitFileChanges(projectId, sha);
      setFileChanges(changes || []);
    } catch {
      setFileChanges([]);
    } finally {
      setLoadingChanges(false);
    }
  }, [projectId, expandedSha]);

  const handleOpenDiff = useCallback(async (sha: string, filePath: string) => {
    try {
      const diff = await (window as any).go.main.App.GetCommitFileDiff(projectId, sha, filePath);
      if (diff) {
        const filename = filePath.split('/').pop() || filePath;
        addTab(focusedPaneId, {
          type: 'review',
          title: `${filename} @ ${sha.slice(0, 7)}`,
          filePath,
          projectId,
        });
      }
    } catch {
      // Ignore errors
    }
  }, [projectId, addTab, focusedPaneId]);

  const changeTypeBadge = (ct: string) => {
    const colors: Record<string, string> = { A: '#34d399', M: '#fb923c', D: '#f87171' };
    const labels: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted' };
    return (
      <span style={{
        fontSize: '10px', fontWeight: 600, padding: '1px 4px',
        borderRadius: '2px', color: '#000',
        background: colors[ct] || 'var(--text-secondary)',
      }}>
        {labels[ct] || ct}
      </span>
    );
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        fontSize: '14px', fontWeight: 600,
      }}>
        Git Log
      </div>

      {error && (
        <div style={{ padding: '6px 16px', fontSize: '12px', color: '#f87171' }}>{error}</div>
      )}

      {/* Commit list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>Loading...</div>}

        {commits.map(commit => (
          <div key={commit.sha}>
            <div
              onClick={() => handleExpandCommit(commit.sha)}
              style={{
                padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '13px', cursor: 'pointer',
                background: expandedSha === commit.sha ? 'var(--bg-hover)' : 'transparent',
              }}
              onMouseEnter={e => { if (expandedSha !== commit.sha) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (expandedSha !== commit.sha) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--accent, #3b82f6)', flexShrink: 0 }}>
                {commit.sha.slice(0, 7)}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {commit.message}
              </span>
              {commit.agentRun !== null && commit.agentRun !== undefined && (
                <span style={{
                  fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                  background: 'var(--accent, #3b82f6)', color: '#fff', flexShrink: 0,
                }}>
                  Agent Run #{commit.agentRun}
                </span>
              )}
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0, minWidth: '60px', textAlign: 'right' }}>
                {commit.author}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0, minWidth: '50px', textAlign: 'right' }}>
                {relativeDate(commit.date)}
              </span>
            </div>

            {/* Expanded file changes */}
            {expandedSha === commit.sha && (
              <div style={{
                padding: '4px 16px 8px 40px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
              }}>
                {loadingChanges ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Loading changes...</span>
                ) : fileChanges.length === 0 ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>No file changes</span>
                ) : (
                  fileChanges.map(fc => (
                    <div
                      key={fc.path}
                      onClick={() => handleOpenDiff(commit.sha, fc.path)}
                      style={{
                        padding: '2px 0', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      {changeTypeBadge(fc.changeType)}
                      <span style={{ color: 'var(--text-primary)' }}>{fc.path}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}

        {/* Load more */}
        {!loading && commits.length > 0 && commits.length % PAGE_SIZE === 0 && (
          <div style={{ padding: '8px 16px' }}>
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                padding: '4px 12px',
                fontSize: '12px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                opacity: loadingMore ? 0.5 : 1,
              }}
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
