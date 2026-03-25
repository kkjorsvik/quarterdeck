// Types matching Go backend models

export interface Project {
  id: number;
  name: string;
  path: string;
  gitDefaultBranch: string;
  devServerUrl: string;
  devServerCommand: string;
  defaultAgentType: string;
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
export type PaneType = 'terminal' | 'editor';
export type SplitDirection = 'horizontal' | 'vertical';

export interface PanelTab {
  id: string;
  type: PaneType;
  title: string;
  terminalId?: string;
  filePath?: string;
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
