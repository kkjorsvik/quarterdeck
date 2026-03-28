// Types matching Go backend models

export interface Project {
  id: number;
  name: string;
  path: string;
  gitDefaultBranch: string;
  devServerUrl: string;
  devServerCommand: string;
  defaultAgentType: string;
  sortOrder: number;
  color: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface SessionInfo {
  id: string;
  command: string;
}

// Layout types
export type PaneType = 'terminal' | 'editor' | 'settings' | 'runHistory' | 'review' | 'workingTree';
export type SplitDirection = 'horizontal' | 'vertical';

export interface PanelTab {
  id: string;
  type: PaneType;
  title: string;
  terminalId?: string;
  filePath?: string;
  projectId?: number;
  runId?: number;
}

export interface LeafNode {
  type: 'leaf';
  id: string;
  tabs: PanelTab[];
  activeTabIndex: number;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = LeafNode | SplitNode;

// Editor types
export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

// Multi-project types
export interface UpdateFields {
  name?: string;
  gitDefaultBranch?: string;
  devServerUrl?: string;
  devServerCommand?: string;
  defaultAgentType?: string;
  sortOrder?: number;
  color?: string;
  notes?: string;
}

export interface ProjectLayout {
  projectId: number;
  tilingTree: LayoutNode;
  editorTabs: EditorTabSnapshot[];
  activeEditorTab: string | null;
  terminalPositions: TerminalPositionSnapshot[];
}

export interface EditorTabSnapshot {
  paneId: string;
  filePath: string;
  cursorPosition: { line: number; column: number };
  scrollPosition: number;
  dirtyContent: string | null;
}

export interface TerminalPositionSnapshot {
  sessionId: string;
  paneId: string;
  tabIndex: number;
}

// Agent types
export type AgentStatusType = 'starting' | 'working' | 'needs_input' | 'done' | 'error';

export interface AgentState {
  id: string;
  projectId: number;
  type: string;
  displayName: string;
  taskDescription: string;
  status: AgentStatusType;
  ptySessionId: string;
  startedAt: string;
  exitCode: number | null;
}

export interface SpawnResult {
  agentId: string;
  ptySessionId: string;
}

// Review types
export interface AgentRunWithStats {
  id: number;
  projectId: number;
  agentType: string;
  taskDescription: string;
  baseCommit: string;
  endCommit: string;
  status: string;
  startedAt: string;
  completedAt: string;
  agentId: string;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface RunFileChange {
  id: number;
  runId: number;
  filePath: string;
  changeType: string;
  additions: number;
  deletions: number;
}

export interface FileDiff {
  filePath: string;
  original: string;
  modified: string;
  changeType: string;
}
