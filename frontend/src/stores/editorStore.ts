import { create } from 'zustand';
import type { OpenFile } from '../lib/types';

// Detect language from file extension
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

interface EditorState {
  openFiles: OpenFile[];
  activeFileIndex: number;

  openFile: (path: string, content: string) => void;
  closeFile: (index: number) => void;
  setActiveFile: (index: number) => void;
  updateContent: (index: number, content: string) => void;
  markSaved: (index: number) => void;
  replaceAll: (files: OpenFile[], activeIndex: number) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFileIndex: -1,

  openFile: (path, content) => {
    const state = get();
    // If already open, just focus it
    const existingIndex = state.openFiles.findIndex(f => f.path === path);
    if (existingIndex >= 0) {
      set({ activeFileIndex: existingIndex });
      return;
    }

    const name = path.split('/').pop() || path;
    const file: OpenFile = {
      path,
      name,
      content,
      language: detectLanguage(name),
      modified: false,
    };
    set({
      openFiles: [...state.openFiles, file],
      activeFileIndex: state.openFiles.length,
    });
  },

  closeFile: (index) => set((state) => {
    const newFiles = state.openFiles.filter((_, i) => i !== index);
    let newActive = state.activeFileIndex;
    if (index === state.activeFileIndex) {
      newActive = Math.min(index, newFiles.length - 1);
    } else if (index < state.activeFileIndex) {
      newActive--;
    }
    return { openFiles: newFiles, activeFileIndex: newActive };
  }),

  setActiveFile: (index) => set({ activeFileIndex: index }),

  updateContent: (index, content) => set((state) => {
    const newFiles = [...state.openFiles];
    if (newFiles[index]) {
      newFiles[index] = { ...newFiles[index], content, modified: true };
    }
    return { openFiles: newFiles };
  }),

  markSaved: (index) => set((state) => {
    const newFiles = [...state.openFiles];
    if (newFiles[index]) {
      newFiles[index] = { ...newFiles[index], modified: false };
    }
    return { openFiles: newFiles };
  }),

  replaceAll: (files, activeIndex) => set({
    openFiles: files,
    activeFileIndex: activeIndex,
  }),
}));
