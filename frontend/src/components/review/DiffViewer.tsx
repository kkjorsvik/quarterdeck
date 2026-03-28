import React, { useEffect, useRef } from 'react';
import '../../lib/monaco-workers';
import * as monaco from 'monaco-editor';

interface DiffViewerProps {
  original: string;
  modified: string;
  filePath: string;
  mode: 'side-by-side' | 'inline';
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    go: 'go', py: 'python', rs: 'rust',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', html: 'html', css: 'css',
    sql: 'sql', sh: 'shell', bash: 'shell',
    toml: 'toml', xml: 'xml', svg: 'xml',
  };
  return langMap[ext] || 'plaintext';
}

export function DiffViewer({ original, modified, filePath, mode }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);

  // Create/destroy editor when mode changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const diffEditor = monaco.editor.createDiffEditor(container, {
      renderSideBySide: mode === 'side-by-side',
      readOnly: true,
      theme: 'vs-dark',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
    });

    editorRef.current = diffEditor;

    const lang = detectLanguage(filePath);
    const origModel = monaco.editor.createModel(original, lang);
    const modModel = monaco.editor.createModel(modified, lang);
    originalModelRef.current = origModel;
    modifiedModelRef.current = modModel;

    diffEditor.setModel({ original: origModel, modified: modModel });

    return () => {
      diffEditor.dispose();
      origModel.dispose();
      modModel.dispose();
      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [mode]);

  // Update models when content/filePath changes (but not on initial mount handled above)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const lang = detectLanguage(filePath);
    const origModel = originalModelRef.current;
    const modModel = modifiedModelRef.current;

    if (origModel && modModel) {
      origModel.setValue(original);
      modModel.setValue(modified);
      monaco.editor.setModelLanguage(origModel, lang);
      monaco.editor.setModelLanguage(modModel, lang);
    }
  }, [original, modified, filePath]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
