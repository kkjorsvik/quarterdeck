import React from 'react';
import type { RunFileChange } from '../../lib/types';
import { useReviewStore } from '../../stores/reviewStore';

interface FileChangeListProps {
  files: RunFileChange[];
  projectId: number;
  baseCommit: string;
  readOnly?: boolean;
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    ts: 'TS', tsx: 'TX', js: 'JS', jsx: 'JX',
    go: 'GO', py: 'PY', rs: 'RS', md: 'MD',
    json: 'JN', yaml: 'YA', yml: 'YA', html: 'HT',
    css: 'CS', sql: 'SQ', sh: 'SH', toml: 'TM',
  };
  return iconMap[ext] || ext.substring(0, 2).toUpperCase() || 'FI';
}

function changeTypeBadge(changeType: string) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    A: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'A' },
    M: { bg: 'rgba(249,115,22,0.15)', color: '#f97316', label: 'M' },
    D: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', label: 'D' },
  };
  const c = config[changeType] || config.M;
  return (
    <span style={{
      fontSize: '10px',
      padding: '0 5px',
      borderRadius: '9999px',
      background: c.bg,
      color: c.color,
      fontWeight: 600,
    }}>
      {c.label}
    </span>
  );
}

export function FileChangeList({ files, projectId, baseCommit, readOnly }: FileChangeListProps) {
  const activeFilePath = useReviewStore(s => s.activeFilePath);
  const fileDecisions = useReviewStore(s => s.fileDecisions);
  const setActiveFile = useReviewStore(s => s.setActiveFile);
  const setDecision = useReviewStore(s => s.setDecision);

  const handleAccept = (e: React.MouseEvent, fp: string) => {
    e.stopPropagation();
    setDecision(fp, 'accepted');
  };

  const handleReject = async (e: React.MouseEvent, fp: string, changeType: string) => {
    e.stopPropagation();
    try {
      await window.go.main.App.RevertFile(projectId, baseCommit, fp, changeType);
      setDecision(fp, 'rejected');
    } catch (err: any) {
      // Show inline error on the element
      const target = e.currentTarget as HTMLElement;
      const originalText = target.textContent;
      target.textContent = 'err';
      target.style.color = '#f87171';
      setTimeout(() => {
        target.textContent = originalText;
        target.style.color = '';
      }, 2000);
    }
  };

  return (
    <div style={{ overflow: 'auto', height: '100%', fontSize: '12px' }}>
      {files.map(file => {
        const decision = fileDecisions.get(file.filePath) || 'pending';
        const isActive = activeFilePath === file.filePath;
        const isRejected = decision === 'rejected';
        const isAccepted = decision === 'accepted';

        return (
          <div
            key={file.filePath}
            onClick={() => setActiveFile(file.filePath)}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: isActive
                ? 'var(--bg-active)'
                : isAccepted
                  ? 'rgba(34,197,94,0.06)'
                  : 'transparent',
              opacity: isRejected ? 0.4 : 1,
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLDivElement).style.background =
                isAccepted ? 'rgba(34,197,94,0.1)' : 'var(--bg-active)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLDivElement).style.background =
                isAccepted ? 'rgba(34,197,94,0.06)' : 'transparent';
            }}
          >
            {/* File icon */}
            <span style={{
              fontSize: '9px',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              flexShrink: 0,
              width: '16px',
              textAlign: 'center',
            }}>
              {getFileIcon(file.filePath)}
            </span>

            {/* Path */}
            <span style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-primary)',
              direction: 'rtl',
              textAlign: 'left',
            }}>
              {file.filePath}
            </span>

            {/* Change type badge */}
            {changeTypeBadge(file.changeType)}

            {/* +N -M */}
            <span style={{ fontSize: '10px', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <span style={{ color: '#22c55e' }}>+{file.additions}</span>
              {' '}
              <span style={{ color: '#ef4444' }}>-{file.deletions}</span>
            </span>

            {/* Accept/Reject buttons */}
            {!readOnly && (
              <span style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                <button
                  onClick={(e) => handleAccept(e, file.filePath)}
                  disabled={isRejected}
                  title="Accept"
                  style={{
                    background: isAccepted ? 'rgba(34,197,94,0.3)' : 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    padding: '1px 4px',
                    fontSize: '11px',
                    cursor: isRejected ? 'not-allowed' : 'pointer',
                    color: isAccepted ? '#22c55e' : 'var(--text-secondary)',
                    opacity: isRejected ? 0.4 : 1,
                  }}
                >
                  {'\u2713'}
                </button>
                <button
                  onClick={(e) => handleReject(e, file.filePath, file.changeType)}
                  title="Reject (revert)"
                  style={{
                    background: isRejected ? 'rgba(239,68,68,0.3)' : 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    padding: '1px 4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    color: isRejected ? '#ef4444' : 'var(--text-secondary)',
                  }}
                >
                  {'\u2717'}
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
