// Type declarations for Wails Go bindings
// These are auto-generated at runtime but we need types for development

import type { Project, FileEntry } from './types';

declare global {
  interface Window {
    go: {
      main: {
        App: {
          GetWSPort(): Promise<number>;
          AddProject(name: string, path: string): Promise<Project>;
          ListProjects(): Promise<Project[]>;
          GetProject(id: number): Promise<Project>;
          DeleteProject(id: number): Promise<void>;
          ReadDir(path: string): Promise<FileEntry[]>;
          ReadDirFiltered(path: string): Promise<FileEntry[]>;
          ReadFile(path: string): Promise<string>;
          WriteFile(path: string, content: string): Promise<void>;
          CreateTerminal(workDir: string, cols: number, rows: number): Promise<string>;
          ResizeTerminal(id: string, cols: number, rows: number): Promise<void>;
          CloseTerminal(id: string): Promise<void>;
          GetGitBranch(projectPath: string): Promise<string>;
          UpdateProject(id: number, fields: string): Promise<void>;
          SaveLayout(projectId: number, layoutJson: string): Promise<void>;
          GetLayout(projectId: number): Promise<string>;
          GetAllLayouts(): Promise<Array<{ projectId: number; layoutJson: string }>>;
        };
      };
    };
  }
}

export {};
