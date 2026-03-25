import React, { useState, useEffect, useCallback } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useProjectStore } from '../../stores/projectStore';

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.split('/').pop() || trimmed;
}

export function AddProjectModal() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const addProject = useProjectStore(s => s.addProject);

  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [prevBasename, setPrevBasename] = useState('');

  const isOpen = active === 'addProject';

  useEffect(() => {
    if (isOpen) {
      setPath('');
      setName('');
      setPrevBasename('');
    }
  }, [isOpen]);

  const handlePathChange = useCallback((newPath: string) => {
    setPath(newPath);
    const newBase = basename(newPath);
    // Auto-update name only if user hasn't manually changed it
    if (name === '' || name === prevBasename) {
      setName(newBase);
    }
    setPrevBasename(newBase);
  }, [name, prevBasename]);

  const handleBrowse = useCallback(async () => {
    try {
      const runtime = (window as any).runtime;
      if (runtime && typeof runtime.OpenDirectoryDialog === 'function') {
        const selected = await runtime.OpenDirectoryDialog({ title: 'Select Project Directory' });
        if (selected) {
          handlePathChange(selected);
        }
        return;
      }
    } catch {
      // Fall through to prompt
    }
    const entered = window.prompt('Enter project directory path:');
    if (entered && entered.trim()) {
      handlePathChange(entered.trim());
    }
  }, [handlePathChange]);

  const handleSubmit = useCallback(async () => {
    const trimmedPath = path.trim();
    const trimmedName = name.trim();
    if (!trimmedPath || !trimmedName) return;
    await addProject(trimmedName, trimmedPath);
    close();
  }, [path, name, addProject, close]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [close, handleSubmit]);

  if (!isOpen) return null;

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '20px',
        width: '420px',
        maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}>
        <h3 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600 }}>
          Add Project
        </h3>

        {/* Directory field */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Directory
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="/path/to/project"
              autoFocus
              style={{
                flex: 1,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '6px 8px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleBrowse}
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '6px 12px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Name field */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            style={{
              width: '100%',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '6px 8px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '6px 16px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!path.trim() || !name.trim()}
            style={{
              background: '#3b82f6',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 16px',
              color: '#fff',
              fontSize: '12px',
              cursor: path.trim() && name.trim() ? 'pointer' : 'not-allowed',
              opacity: path.trim() && name.trim() ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
