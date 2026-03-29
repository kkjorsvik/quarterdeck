import React, { useState, useEffect, useCallback } from 'react';
import type { Branch, MergeResult } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';

interface BranchPanelProps {
  projectId: number;
}

export function BranchPanel({ projectId }: BranchPanelProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchStart, setNewBranchStart] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [actionError, setActionError] = useState('');

  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const refreshGitStatus = useProjectStore(s => s.refreshGitStatus);

  const loadBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const result: Branch[] = await (window as any).go.main.App.ListBranches(projectId);
      setBranches(result || []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const handleSwitch = useCallback(async (name: string) => {
    setActionError('');
    try {
      // Check for dirty working tree
      const statuses = await (window as any).go.main.App.GetGitStatus(projectId);
      if (statuses && statuses.length > 0) {
        if (!window.confirm('Working tree has uncommitted changes. Switch anyway?')) {
          return;
        }
      }
      await (window as any).go.main.App.SwitchBranch(projectId, name);
      await loadBranches();
      await refreshGitStatus();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  }, [projectId, loadBranches, refreshGitStatus]);

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete branch "${name}"?`)) return;
    setActionError('');
    try {
      await (window as any).go.main.App.DeleteBranch(projectId, name, false);
      await loadBranches();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  }, [projectId, loadBranches]);

  const handleMerge = useCallback(async (name: string) => {
    setActionError('');
    try {
      const result: MergeResult = await (window as any).go.main.App.MergeBranch(projectId, name);
      if (result.hasConflict) {
        addTab(focusedPaneId, { type: 'conflicts', title: 'Conflicts', projectId });
      }
      if (!result.success && !result.hasConflict) {
        setActionError(result.message || 'Merge failed');
      }
      await loadBranches();
      await refreshGitStatus();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  }, [projectId, loadBranches, refreshGitStatus, addTab, focusedPaneId]);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    setActionError('');
    try {
      await (window as any).go.main.App.CreateBranch(projectId, newBranchName.trim(), newBranchStart.trim());
      setNewBranchName('');
      setNewBranchStart('');
      setShowNewBranch(false);
      await loadBranches();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  }, [projectId, newBranchName, newBranchStart, loadBranches]);

  const current = branches.find(b => b.isCurrent);
  const others = branches.filter(b => !b.isCurrent);

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
        <span style={{ fontSize: '14px', fontWeight: 600 }}>Branches</span>
        <button
          onClick={() => setShowNewBranch(!showNewBranch)}
          style={smallBtnStyle}
        >
          + New Branch
        </button>
      </div>

      {/* New branch form */}
      {showNewBranch && (
        <div style={{
          padding: '8px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', gap: '6px', alignItems: 'center',
        }}>
          <input
            placeholder="Branch name"
            value={newBranchName}
            onChange={e => setNewBranchName(e.target.value)}
            style={inputStyle}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); }}
          />
          <input
            placeholder="Start point (optional)"
            value={newBranchStart}
            onChange={e => setNewBranchStart(e.target.value)}
            style={{ ...inputStyle, width: '140px' }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); }}
          />
          <button onClick={handleCreateBranch} style={smallBtnStyle}>Create</button>
        </div>
      )}

      {/* Error */}
      {(error || actionError) && (
        <div style={{ padding: '6px 16px', fontSize: '12px', color: '#f87171' }}>
          {error || actionError}
        </div>
      )}

      {/* Branch list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {loading && <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>Loading...</div>}

        {/* Current branch */}
        {current && (
          <div style={{
            padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px',
            background: 'var(--bg-hover)',
          }}>
            <span style={{ color: '#34d399', fontSize: '12px' }}>&#10003;</span>
            <span style={{ fontWeight: 600, fontSize: '13px' }}>{current.name}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
              {current.commitSha.slice(0, 7)}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {current.commitMsg}
            </span>
            {current.aheadBehind && (
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{current.aheadBehind}</span>
            )}
          </div>
        )}

        {/* Other branches */}
        {others.map(b => (
          <div
            key={b.name}
            style={{
              padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '13px',
            }}
          >
            {b.isWorktree && <span title="Used by worktree" style={{ fontSize: '12px' }}>&#128274;</span>}
            <span>{b.name}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
              {b.commitSha.slice(0, 7)}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {b.commitMsg}
            </span>
            {b.aheadBehind && (
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{b.aheadBehind}</span>
            )}
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              <button
                onClick={() => handleSwitch(b.name)}
                disabled={b.isWorktree}
                style={{ ...smallBtnStyle, opacity: b.isWorktree ? 0.4 : 1 }}
                title={b.isWorktree ? 'Branch is used by a worktree' : 'Switch to this branch'}
              >
                Switch
              </button>
              <button onClick={() => handleMerge(b.name)} style={smallBtnStyle}>Merge</button>
              <button onClick={() => handleDelete(b.name)} style={{ ...smallBtnStyle, color: '#f87171' }}>Del</button>
            </div>
          </div>
        ))}

        {!loading && branches.length === 0 && (
          <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>No branches found</div>
        )}
      </div>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  padding: '2px 8px',
  fontSize: '11px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '3px',
  padding: '4px 6px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  outline: 'none',
  flex: 1,
};
