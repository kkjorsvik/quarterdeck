import React, { useEffect, useState, useMemo, useCallback } from 'react';
import type { RunFileChange, AgentRunWithStats, FileDiff } from '../../lib/types';
import { useReviewStore } from '../../stores/reviewStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { FileChangeList } from './FileChangeList';
import { DiffViewer } from './DiffViewer';
import { useDiffKeybindings } from '../../hooks/useDiffKeybindings';

interface RunReviewProps {
  runId: number;
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

export function RunReview({ runId, projectId }: RunReviewProps) {
  const [files, setFiles] = useState<RunFileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const runInfo = useReviewStore(s => s.runInfo);
  const activeFilePath = useReviewStore(s => s.activeFilePath);
  const diffMode = useReviewStore(s => s.diffMode);
  const fileDecisions = useReviewStore(s => s.fileDecisions);
  const setRun = useReviewStore(s => s.setRun);
  const setActiveFile = useReviewStore(s => s.setActiveFile);
  const setDecision = useReviewStore(s => s.setDecision);
  const toggleDiffMode = useReviewStore(s => s.toggleDiffMode);
  const acceptAll = useReviewStore(s => s.acceptAll);
  const rejectAll = useReviewStore(s => s.rejectAll);
  const getAcceptedFiles = useReviewStore(s => s.getAcceptedFiles);
  const openOverlay = useOverlayStore(s => s.open);

  // Derive accepted count from fileDecisions directly
  const acceptedCount = useMemo(() => {
    let count = 0;
    fileDecisions.forEach((d) => { if (d === 'accepted') count++; });
    return count;
  }, [fileDecisions]);

  // Load run info and file changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([
      window.go.main.App.GetRunFileChanges(runId),
      window.go.main.App.ListProjectRuns(projectId),
    ])
      .then(([fileChanges, runs]) => {
        if (cancelled) return;
        setFiles(fileChanges || []);
        const run = (runs || []).find((r: AgentRunWithStats) => r.id === runId);
        if (run) {
          setRun(runId, projectId, {
            agentType: run.agentType,
            taskDescription: run.taskDescription,
            baseCommit: run.baseCommit,
            endCommit: run.endCommit,
          });
        }
        // Auto-select first file
        if (fileChanges && fileChanges.length > 0) {
          setActiveFile(fileChanges[0].filePath);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [runId, projectId]);

  // Load diff when active file changes
  useEffect(() => {
    if (!activeFilePath || !runInfo) return;
    let cancelled = false;
    setDiffLoading(true);

    window.go.main.App.GetFileDiff(projectId, runInfo.baseCommit, runInfo.endCommit, activeFilePath)
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
  }, [activeFilePath, runInfo, projectId]);

  const handleAcceptAll = useCallback(() => {
    acceptAll(files.map(f => f.filePath));
  }, [files, acceptAll]);

  const handleRejectAll = useCallback(async () => {
    if (!runInfo) return;
    for (const file of files) {
      const decision = fileDecisions.get(file.filePath);
      if (decision !== 'rejected') {
        try {
          await window.go.main.App.RevertFile(projectId, runInfo.baseCommit, file.filePath, file.changeType);
          setDecision(file.filePath, 'rejected');
        } catch {
          // Continue with next file
        }
      }
    }
  }, [files, runInfo, projectId, fileDecisions, setDecision]);

  const handleCommit = useCallback(() => {
    openOverlay('commitReview');
  }, [openOverlay]);

  // Navigate files
  const navigateFile = useCallback((direction: 1 | -1) => {
    if (files.length === 0) return;
    const currentIdx = files.findIndex(f => f.filePath === activeFilePath);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + direction + files.length) % files.length;
    setActiveFile(files[nextIdx].filePath);
  }, [files, activeFilePath, setActiveFile]);

  // Keybindings
  useDiffKeybindings(true, {
    onNextFile: () => navigateFile(1),
    onPrevFile: () => navigateFile(-1),
    onAccept: () => {
      if (activeFilePath) setDecision(activeFilePath, 'accepted');
    },
    onReject: async () => {
      if (activeFilePath && runInfo) {
        const file = files.find(f => f.filePath === activeFilePath);
        if (file) {
          try {
            await window.go.main.App.RevertFile(projectId, runInfo.baseCommit, file.filePath, file.changeType);
            setDecision(file.filePath, 'rejected');
          } catch { /* ignore */ }
        }
      }
    },
    onCommit: handleCommit,
    onToggleMode: toggleDiffMode,
  });

  if (loading) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        Loading review...
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
        flexWrap: 'wrap',
      }}>
        {runInfo && (
          <>
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              background: 'var(--bg-primary)',
              borderRadius: '3px',
              padding: '2px 4px',
              fontFamily: 'monospace',
            }}>
              {getTypeIcon(runInfo.agentType)}
            </span>
            <span style={{
              color: 'var(--text-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {runInfo.taskDescription || '(no description)'}
            </span>
          </>
        )}

        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button onClick={handleAcceptAll} style={toolbarBtnStyle} title="Accept All (non-rejected)">
            Accept All
          </button>
          <button onClick={handleRejectAll} style={toolbarBtnStyle} title="Reject All">
            Reject All
          </button>
          {acceptedCount > 0 && (
            <button
              onClick={handleCommit}
              style={{ ...toolbarBtnStyle, background: 'var(--accent, #3b82f6)', color: '#fff' }}
              title="Commit accepted changes"
            >
              Commit Reviewed ({acceptedCount})
            </button>
          )}
          <button
            onClick={toggleDiffMode}
            style={toolbarBtnStyle}
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
            baseCommit={runInfo?.baseCommit || ''}
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

const toolbarBtnStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '3px 10px',
  fontSize: '11px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
