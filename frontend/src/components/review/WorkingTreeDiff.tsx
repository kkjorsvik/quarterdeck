import React, { useEffect, useState, useCallback } from 'react';
import type { RunFileChange, FileDiff } from '../../lib/types';
import { useReviewStore } from '../../stores/reviewStore';
import { FileChangeList } from './FileChangeList';
import { DiffViewer } from './DiffViewer';
import { useDiffKeybindings } from '../../hooks/useDiffKeybindings';
import { useLayoutStore } from '../../stores/layoutStore';

interface WorkingTreeDiffProps {
  projectId: number;
}

export function WorkingTreeDiff({ projectId }: WorkingTreeDiffProps) {
  const [files, setFiles] = useState<RunFileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const activeFilePath = useReviewStore(s => s.activeFilePath);
  const diffMode = useReviewStore(s => s.diffMode);
  const setActiveFile = useReviewStore(s => s.setActiveFile);
  const toggleDiffMode = useReviewStore(s => s.toggleDiffMode);
  const removeTab = useLayoutStore(s => s.removeTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const getFocusedLeaf = useLayoutStore(s => s.getFocusedLeaf);

  // Load working tree changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    window.go.main.App.GetWorkingTreeChanges(projectId)
      .then((result) => {
        if (cancelled) return;
        setFiles(result || []);
        if (result && result.length > 0) {
          setActiveFile(result[0].filePath);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectId]);

  // Load diff when active file changes
  useEffect(() => {
    if (!activeFilePath) return;
    let cancelled = false;
    setDiffLoading(true);

    window.go.main.App.GetWorkingTreeFileDiff(projectId, activeFilePath)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeFilePath, projectId]);

  const navigateFile = useCallback((direction: 1 | -1) => {
    if (files.length === 0) return;
    const currentIdx = files.findIndex(f => f.filePath === activeFilePath);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + direction + files.length) % files.length;
    setActiveFile(files[nextIdx].filePath);
  }, [files, activeFilePath, setActiveFile]);

  const handleClose = useCallback(() => {
    const leaf = getFocusedLeaf();
    if (leaf) {
      removeTab(focusedPaneId, leaf.activeTabIndex);
    }
  }, [getFocusedLeaf, removeTab, focusedPaneId]);

  useDiffKeybindings(true, {
    onNextFile: () => navigateFile(1),
    onPrevFile: () => navigateFile(-1),
    onClose: handleClose,
    onToggleMode: toggleDiffMode,
  });

  if (loading) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        Loading working tree changes...
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

  if (files.length === 0) {
    return (
      <div style={{
        padding: '40px 20px',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        textAlign: 'center',
      }}>
        No uncommitted changes in working tree
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: '12px',
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          Working Tree Changes
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={toggleDiffMode}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '3px 10px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
            title={`Switch to ${diffMode === 'side-by-side' ? 'inline' : 'side-by-side'} diff`}
          >
            {diffMode === 'side-by-side' ? 'Inline' : 'Side-by-Side'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File list - left 30% */}
        <div style={{ width: '30%', minWidth: '200px', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
          <FileChangeList
            files={files}
            projectId={projectId}
            baseCommit=""
            readOnly
          />
        </div>

        {/* Diff viewer - right 70% */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {diffLoading ? (
            <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Loading diff...
            </div>
          ) : diff ? (
            <DiffViewer
              original={diff.original}
              modified={diff.modified}
              filePath={diff.filePath}
              mode={diffMode}
            />
          ) : (
            <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Select a file to view diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
