import React, { useEffect, useState, useMemo } from 'react';
import type { AgentRunWithStats } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';

interface RunHistoryProps {
  projectId: number;
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'claude': return 'CC';
    case 'codex': return 'CX';
    case 'opencode': return 'OC';
    default: return type.substring(0, 2).toUpperCase();
  }
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function duration(startedAt: string, completedAt: string): string {
  if (!startedAt || !completedAt) return '';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function RunHistory({ projectId }: RunHistoryProps) {
  const [runs, setRuns] = useState<AgentRunWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    window.go.main.App.ListProjectRuns(projectId)
      .then((result) => {
        if (!cancelled) setRuns(result || []);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [runs]
  );

  const handleClick = (run: AgentRunWithStats) => {
    const title = 'Review: ' + (run.taskDescription || 'Run').slice(0, 20);
    addTab(focusedPaneId, { type: 'review', title, runId: run.id, projectId });
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        Loading runs...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: '#f87171', fontSize: '13px' }}>
        Error: {error}
      </div>
    );
  }

  if (sortedRuns.length === 0) {
    return (
      <div style={{
        padding: '40px 20px',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        textAlign: 'center',
      }}>
        No agent runs yet. Start an agent with Ctrl+Shift+A
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '8px 0' }}>
      {sortedRuns.map(run => (
        <div
          key={run.id}
          onClick={() => handleClick(run)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            borderBottom: '1px solid var(--border)',
            fontSize: '12px',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-active)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          {/* Type icon */}
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            borderRadius: '3px',
            padding: '2px 4px',
            flexShrink: 0,
            fontFamily: 'monospace',
            marginTop: '2px',
          }}>
            {getTypeIcon(run.agentType)}
          </span>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: 'var(--text-primary)',
              fontSize: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {run.taskDescription || '(no description)'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              {/* Status badge */}
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '9999px',
                background: run.status === 'done' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: run.status === 'done' ? '#22c55e' : '#ef4444',
                fontWeight: 600,
              }}>
                {run.status === 'done' ? 'Done' : 'Error'}
              </span>
              {/* Time info */}
              <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                {relativeTime(run.completedAt || run.startedAt)}
              </span>
              {run.completedAt && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                  {duration(run.startedAt, run.completedAt)}
                </span>
              )}
              {/* Change summary */}
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                <span style={{ color: '#22c55e' }}>+{run.totalAdditions}</span>
                {' '}
                <span style={{ color: '#ef4444' }}>-{run.totalDeletions}</span>
                {' '}across {run.fileCount} file{run.fileCount !== 1 ? 's' : ''}
              </span>
              {/* Base commit */}
              {run.baseCommit && (
                <span style={{
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                }}>
                  {run.baseCommit.slice(0, 7)}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
