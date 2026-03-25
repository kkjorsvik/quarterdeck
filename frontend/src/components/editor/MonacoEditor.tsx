import React, { useRef, useEffect } from 'react';
import { useMonaco } from '../../hooks/useMonaco';
import { useEditorStore } from '../../stores/editorStore';

interface MonacoEditorProps {
  filePath?: string;
}

export function MonacoEditor({ filePath }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);

  const openFiles = useEditorStore(s => s.openFiles);
  const updateContent = useEditorStore(s => s.updateContent);
  const markSaved = useEditorStore(s => s.markSaved);

  const fileIndex = openFiles.findIndex(f => f.path === filePath);
  const file = fileIndex >= 0 ? openFiles[fileIndex] : null;

  const { editor, setValue } = useMonaco(containerRef, statusBarRef, {
    value: file?.content || '',
    language: file?.language || 'plaintext',
    onChange: (value) => {
      if (fileIndex >= 0) {
        updateContent(fileIndex, value);
      }
    },
    onSave: async (value) => {
      if (file) {
        try {
          await window.go.main.App.WriteFile(file.path, value);
          markSaved(fileIndex);
        } catch (err) {
          console.error('Failed to save file:', err);
        }
      }
    },
  });

  // Update editor content when filePath changes
  useEffect(() => {
    if (file) {
      setValue(file.content, file.language);
    }
  }, [filePath]);

  if (!file) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        No file open
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
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
