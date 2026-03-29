import React, { useState, useEffect, useCallback } from 'react';
import type { StashEntry } from '../../lib/types';
import { useProjectStore } from '../../stores/projectStore';

interface StashPanelProps {
  projectId: number;
  onClose: () => void;
}

export function StashPanel({ projectId, onClose }: StashPanelProps) {
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pushing, setPushing] = useState(false);
  const refreshGitStatus = useProjectStore(s => s.refreshGitStatus);

  const loadStashes = useCallback(async () => {
    try {
      setLoading(true);
      const result: StashEntry[] = await (window as any).go.main.App.StashList(projectId);
      setStashes(result || []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadStashes();
  }, [loadStashes]);

  const handleStashPush = useCallback(async () => {
    if (pushing) return;
    setPushing(true);
    setError('');
    try {
      await (window as any).go.main.App.StashPush(projectId, message);
      setMessage('');
      await loadStashes();
      await refreshGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPushing(false);
    }
  }, [projectId, message, pushing, loadStashes, refreshGitStatus]);

  const handlePop = useCallback(async (index: number) => {
    setError('');
    try {
      await (window as any).go.main.App.StashPop(projectId, index);
      await loadStashes();
      await refreshGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, [projectId, loadStashes, refreshGitStatus]);

  const handleDrop = useCallback(async (index: number) => {
    if (!window.confirm(`Drop stash@{${index}}? This cannot be undone.`)) return;
    setError('');
    try {
      await (window as any).go.main.App.StashDrop(projectId, index);
      await loadStashes();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, [projectId, loadStashes]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '16px',
        width: '480px',
        maxWidth: '90vw',
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Stash</span>
          <button onClick={onClose} style={{ ...btnStyle, padding: '2px 8px' }}>Close</button>
        </div>

        {/* Stash push */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            placeholder="Stash message (optional)"
            value={message}
            onChange={e => setMessage(e.target.value)}
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') handleStashPush(); }}
          />
          <button
            onClick={handleStashPush}
            disabled={pushing}
            style={{ ...btnStyle, background: 'var(--accent, #3b82f6)', color: '#fff', opacity: pushing ? 0.5 : 1 }}
          >
            {pushing ? 'Stashing...' : 'Stash'}
          </button>
        </div>

        {error && <div style={{ fontSize: '12px', color: '#f87171' }}>{error}</div>}

        {/* Stash list */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {loading && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading...</div>}
          {!loading && stashes.length === 0 && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No stashes</div>
          )}
          {stashes.map(s => (
            <div key={s.index} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 0', borderBottom: '1px solid var(--border)',
              fontSize: '12px',
            }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', flexShrink: 0 }}>
                stash@{'{' + s.index + '}'}
              </span>
              <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.message || '(no message)'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                {s.date}
              </span>
              <button onClick={() => handlePop(s.index)} style={btnStyle}>Pop</button>
              <button onClick={() => handleDrop(s.index)} style={{ ...btnStyle, color: '#f87171' }}>Drop</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  padding: '3px 10px',
  fontSize: '11px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  padding: '4px 8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  outline: 'none',
  flex: 1,
};
