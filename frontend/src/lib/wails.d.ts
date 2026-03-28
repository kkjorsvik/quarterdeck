// Type declarations for Wails Go bindings
// These are auto-generated at runtime but we need types for development

import type { Project, FileEntry, AgentRunWithStats, RunFileChange, FileDiff } from './types';

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
          ListProjectFiles(projectPath: string): Promise<string[]>;
          GetGitBranch(projectPath: string): Promise<string>;
          UpdateProject(id: number, fields: string): Promise<void>;
          SaveLayout(projectId: number, layoutJson: string): Promise<void>;
          GetLayout(projectId: number): Promise<string>;
          GetAllLayouts(): Promise<Array<{ projectId: number; layoutJson: string }>>;
          ListProjectRuns(projectId: number): Promise<AgentRunWithStats[]>;
          GetRunFileChanges(runId: number): Promise<RunFileChange[]>;
          GetRunByAgentID(agentId: string): Promise<AgentRunWithStats | null>;
          GetFileDiff(projectId: number, baseCommit: string, endCommit: string, filePath: string): Promise<FileDiff>;
          RevertFile(projectId: number, baseCommit: string, filePath: string, changeType: string): Promise<void>;
          CommitReviewedChanges(projectId: number, message: string, filePaths: string[], push: boolean): Promise<string>;
          GetWorkingTreeChanges(projectId: number): Promise<RunFileChange[]>;
          GetWorkingTreeFileDiff(projectId: number, filePath: string): Promise<FileDiff>;
        };
      };
    };
  }
}

export {};
