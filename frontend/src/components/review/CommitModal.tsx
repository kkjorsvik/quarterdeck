import React, { useState, useEffect, useCallback } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useReviewStore } from '../../stores/reviewStore';

export function CommitModal() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const runInfo = useReviewStore(s => s.runInfo);
  const runId = useReviewStore(s => s.runId);
  const projectId = useReviewStore(s => s.projectId);
  const getAcceptedFiles = useReviewStore(s => s.getAcceptedFiles);
  const reset = useReviewStore(s => s.reset);

  const [message, setMessage] = useState('');
  const [push, setPush] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (active === 'commitReview' && runInfo && runId) {
      const defaultMsg = `[${runInfo.agentType}] ${runInfo.taskDescription}\n\nAgent-Run: ${runId}`;
      setMessage(defaultMsg);
      setPush(false);
      setError('');
      setCommitting(false);
    }
  }, [active, runInfo, runId]);

  const handleCommit = useCallback(async () => {
    if (committing || !projectId) return;
    const accepted = getAcceptedFiles();
    if (accepted.length === 0) {
      setError('No accepted files to commit');
      return;
    }

    setCommitting(true);
    setError('');

    try {
      await window.go.main.App.CommitReviewedChanges(
        projectId, message, accepted, push
      );
      close();
      reset();
    } catch (err: any) {
      setError(err?.message || String(err) || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }, [committing, projectId, getAcceptedFiles, message, push, close, reset]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  }, [close, handleCommit]);

  if (active !== 'commitReview') return null;

  const acceptedFiles = getAcceptedFiles();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={handleKeyDown}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '20px',
        width: '480px',
        maxWidth: '90vw',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Commit Reviewed Changes
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {acceptedFiles.length} file{acceptedFiles.length !== 1 ? 's' : ''} accepted
        </div>

        {/* Commit message */}
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={5}
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '8px',
            fontSize: '13px',
            color: 'var(--text-primary)',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontFamily: 'JetBrains Mono, monospace',
          }}
          autoFocus
        />

        {/* Push checkbox */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={push}
            onChange={e => setPush(e.target.checked)}
          />
          Push after commit
        </label>

        {/* File list preview */}
        <div style={{
          maxHeight: '100px',
          overflow: 'auto',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          background: 'var(--bg-primary)',
          borderRadius: '4px',
          padding: '6px 8px',
        }}>
          {acceptedFiles.map(fp => (
            <div key={fp} style={{ padding: '1px 0' }}>{fp}</div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ fontSize: '12px', color: '#f87171', padding: '4px 0' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={close} style={buttonStyle}>Cancel</button>
          <button
            onClick={handleCommit}
            disabled={committing || acceptedFiles.length === 0}
            style={{
              ...buttonStyle,
              background: 'var(--accent, #3b82f6)',
              color: '#fff',
              opacity: committing ? 0.6 : 1,
            }}
          >
            {committing ? 'Committing...' : 'Commit'}
          </button>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          Ctrl+Enter to commit, Escape to cancel
        </div>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '6px 16px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};
