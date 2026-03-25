import { create } from 'zustand';
import type { LayoutNode, LeafNode, SplitNode, SplitDirection, PaneType } from '../lib/types';

// Helper to generate unique IDs
let nextId = 0;
const genId = () => `pane-${++nextId}`;

interface LayoutState {
  root: LayoutNode;
  focusedPaneId: string;

  splitPane: (paneId: string, direction: SplitDirection, newPaneType?: PaneType) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  setPaneContent: (paneId: string, paneType: PaneType, data?: { filePath?: string; terminalId?: string }) => void;
  setFocusedPane: (paneId: string) => void;
}

function findAndReplace(node: LayoutNode, targetId: string, replacer: (node: LeafNode) => LayoutNode): LayoutNode | null {
  if (node.type === 'leaf') {
    if (node.id === targetId) {
      return replacer(node);
    }
    return null;
  }

  const leftResult = findAndReplace(node.children[0], targetId, replacer);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }

  const rightResult = findAndReplace(node.children[1], targetId, replacer);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }

  return null;
}

function removePane(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.id === targetId ? null : node;
  }

  const leftResult = removePane(node.children[0], targetId);
  const rightResult = removePane(node.children[1], targetId);

  if (leftResult === null) return rightResult;
  if (rightResult === null) return leftResult;

  return { ...node, children: [leftResult, rightResult] };
}

function findFirstLeaf(node: LayoutNode): string {
  if (node.type === 'leaf') return node.id;
  return findFirstLeaf(node.children[0]);
}

const initialPaneId = genId();

export const useLayoutStore = create<LayoutState>((set) => ({
  root: {
    type: 'leaf',
    id: initialPaneId,
    paneType: 'terminal',
  } as LeafNode,
  focusedPaneId: initialPaneId,

  splitPane: (paneId, direction, newPaneType = 'terminal') => set((state) => {
    const newId = genId();
    const result = findAndReplace(state.root, paneId, (leaf) => ({
      type: 'split',
      id: genId(),
      direction,
      ratio: 0.5,
      children: [leaf, { type: 'leaf', id: newId, paneType: newPaneType } as LeafNode],
    } as SplitNode));

    if (!result) return state;
    return { root: result, focusedPaneId: newId };
  }),

  closePane: (paneId) => set((state) => {
    const result = removePane(state.root, paneId);
    if (!result) {
      // Don't close the last pane
      return state;
    }
    const newFocused = state.focusedPaneId === paneId ? findFirstLeaf(result) : state.focusedPaneId;
    return { root: result, focusedPaneId: newFocused };
  }),

  resizeSplit: (splitId, ratio) => set((state) => {
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    const update = (node: LayoutNode): LayoutNode => {
      if (node.type === 'leaf') return node;
      if (node.id === splitId) return { ...node, ratio: clamped };
      return { ...node, children: [update(node.children[0]), update(node.children[1])] };
    };
    return { root: update(state.root) };
  }),

  setPaneContent: (paneId, paneType, data) => set((state) => {
    const result = findAndReplace(state.root, paneId, (leaf) => ({
      ...leaf,
      paneType,
      filePath: data?.filePath,
      terminalId: data?.terminalId,
    }));
    if (!result) return state;
    return { root: result };
  }),

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
}));
