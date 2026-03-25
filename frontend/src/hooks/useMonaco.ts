import { useEffect, useRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import { initVimMode } from 'monaco-vim';

interface UseMonacoOptions {
  language?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
}

export function useMonaco(
  containerRef: React.RefObject<HTMLDivElement | null>,
  statusBarRef: React.RefObject<HTMLDivElement | null>,
  options: UseMonacoOptions
) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const vimModeRef = useRef<any>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value: options.value || '',
      language: options.language || 'plaintext',
      theme: 'vs-dark',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      padding: { top: 8 },
      tabSize: 2,
    });

    editorRef.current = editor;

    // Initialize vim mode
    if (statusBarRef.current) {
      vimModeRef.current = initVimMode(editor, statusBarRef.current);
    }

    // Ctrl+S save handler
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const value = editor.getValue();
      options.onSave?.(value);
    });

    // Content change handler
    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      options.onChange?.(value);
    });

    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
      }
      editor.dispose();
    };
  }, []); // Mount once

  // Update content when value changes externally
  const setValue = useCallback((value: string, language?: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (model) {
      // Preserve undo stack by using pushEditOperations
      model.setValue(value);
      if (language) {
        monaco.editor.setModelLanguage(model, language);
      }
    }
  }, []);

  return { editor: editorRef, setValue };
}
