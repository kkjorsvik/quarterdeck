import React, { useRef, useEffect } from 'react';
import { useMonaco } from '../../hooks/useMonaco';
import { useEditorStore } from '../../stores/editorStore';

export function MonacoEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);

  const openFiles = useEditorStore(s => s.openFiles);
  const activeFileIndex = useEditorStore(s => s.activeFileIndex);
  const updateContent = useEditorStore(s => s.updateContent);
  const markSaved = useEditorStore(s => s.markSaved);
  const setActiveFile = useEditorStore(s => s.setActiveFile);
  const closeFile = useEditorStore(s => s.closeFile);

  const activeFile = activeFileIndex >= 0 ? openFiles[activeFileIndex] : null;

  const { editor, setValue } = useMonaco(containerRef, statusBarRef, {
    value: activeFile?.content || '',
    language: activeFile?.language || 'plaintext',
    onChange: (value) => {
      if (activeFileIndex >= 0) {
        updateContent(activeFileIndex, value);
      }
    },
    onSave: async (value) => {
      if (activeFile) {
        try {
          await window.go.main.App.WriteFile(activeFile.path, value);
          markSaved(activeFileIndex);
        } catch (err) {
          console.error('Failed to save file:', err);
        }
      }
    },
  });

  // Update editor content when active file changes
  useEffect(() => {
    if (activeFile) {
      setValue(activeFile.content, activeFile.language);
    }
  }, [activeFileIndex]);

  if (openFiles.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        No files open
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* File tabs */}
      <div style={{
        display: 'flex',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        overflow: 'auto',
        flexShrink: 0,
      }}>
        {openFiles.map((file, index) => (
          <div
            key={file.path}
            onClick={() => setActiveFile(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '12px',
              borderRight: '1px solid var(--border)',
              background: index === activeFileIndex ? 'var(--bg-primary)' : 'transparent',
              color: index === activeFileIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            <span>{file.modified ? '● ' : ''}{file.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(index); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 0,
                fontSize: '12px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {/* Editor */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
      {/* Vim status bar */}
      <div
        ref={statusBarRef}
        style={{
          height: '20px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border)',
          padding: '0 8px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      />
    </div>
  );
}
