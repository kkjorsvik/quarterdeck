import { create } from 'zustand';
import type { LayoutNode, LeafNode, SplitNode, SplitDirection, PaneType, PanelTab } from '../lib/types';

let nextId = 0;
const genId = () => `pane-${++nextId}`;
const genTabId = () => `tab-${++nextId}`;

interface LayoutState {
  root: LayoutNode;
  focusedPaneId: string;

  splitPane: (paneId: string, direction: SplitDirection, newPaneType?: PaneType) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  setFocusedPane: (paneId: string) => void;
  addTab: (paneId: string, tab: Omit<PanelTab, 'id'>) => void;
  removeTab: (paneId: string, tabIndex: number) => void;
  setActiveTab: (paneId: string, tabIndex: number) => void;
  cycleTab: (paneId: string, direction: 1 | -1) => void;
  getLeafById: (paneId: string) => LeafNode | undefined;
  getFocusedLeaf: () => LeafNode | undefined;
  getEditorPaneId: () => string | undefined;
  setRoot: (root: LayoutNode) => void;
  createProjectLayout: () => void;
}

function findLeaf(node: LayoutNode, id: string): LeafNode | undefined {
  if (node.type === 'leaf') return node.id === id ? node : undefined;
  return findLeaf(node.children[0], id) || findLeaf(node.children[1], id);
}

function findAndReplace(node: LayoutNode, targetId: string, replacer: (node: LeafNode) => LayoutNode): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.id === targetId ? replacer(node) : null;
  }
  const left = findAndReplace(node.children[0], targetId, replacer);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = findAndReplace(node.children[1], targetId, replacer);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function updateLeaf(node: LayoutNode, targetId: string, updater: (node: LeafNode) => LeafNode): LayoutNode {
  if (node.type === 'leaf') {
    return node.id === targetId ? updater(node) : node;
  }
  return {
    ...node,
    children: [
      updateLeaf(node.children[0], targetId, updater),
      updateLeaf(node.children[1], targetId, updater),
    ],
  };
}

function removePane(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === targetId ? null : node;
  const left = removePane(node.children[0], targetId);
  const right = removePane(node.children[1], targetId);
  if (left === null) return right;
  if (right === null) return left;
  return { ...node, children: [left, right] };
}

function findFirstLeaf(node: LayoutNode): string {
  if (node.type === 'leaf') return node.id;
  return findFirstLeaf(node.children[0]);
}

function maxIdInTree(node: LayoutNode): number {
  const numId = (id: string) => {
    const match = id.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  if (node.type === 'leaf') {
    let max = numId(node.id);
    for (const tab of node.tabs) {
      max = Math.max(max, numId(tab.id));
    }
    return max;
  }

  return Math.max(
    numId(node.id),
    maxIdInTree(node.children[0]),
    maxIdInTree(node.children[1])
  );
}

// Find the first leaf that has at least one editor tab, or the first leaf with no terminal-only tabs
function findEditorLeaf(node: LayoutNode): LeafNode | undefined {
  if (node.type === 'leaf') {
    return node.tabs.some(t => t.type === 'editor') ? node : undefined;
  }
  return findEditorLeaf(node.children[0]) || findEditorLeaf(node.children[1]);
}

const initialPaneId = genId();

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: {
    type: 'leaf',
    id: initialPaneId,
    tabs: [{ id: genTabId(), type: 'terminal' as PaneType, title: 'Terminal' }],
    activeTabIndex: 0,
  } as LeafNode,
  focusedPaneId: initialPaneId,

  splitPane: (paneId, direction, newPaneType = 'terminal') => set((state) => {
    const newPaneId = genId();
    const result = findAndReplace(state.root, paneId, (leaf) => ({
      type: 'split',
      id: genId(),
      direction,
      ratio: 0.5,
      children: [
        leaf,
        {
          type: 'leaf',
          id: newPaneId,
          tabs: [{ id: genTabId(), type: newPaneType, title: newPaneType === 'terminal' ? 'Terminal' : 'Editor' }],
          activeTabIndex: 0,
        } as LeafNode,
      ],
    } as SplitNode));
    if (!result) return state;
    return { root: result, focusedPaneId: newPaneId };
  }),

  closePane: (paneId) => set((state) => {
    const result = removePane(state.root, paneId);
    if (!result) return state;
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

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  addTab: (paneId, tab) => set((state) => {
    const newTab: PanelTab = { ...tab, id: genTabId() };
    return {
      root: updateLeaf(state.root, paneId, (leaf) => ({
        ...leaf,
        tabs: [...leaf.tabs, newTab],
        activeTabIndex: leaf.tabs.length,
      })),
    };
  }),

  removeTab: (paneId, tabIndex) => set((state) => {
    const leaf = findLeaf(state.root, paneId);
    if (!leaf) return state;

    if (leaf.tabs.length <= 1) {
      const result = removePane(state.root, paneId);
      if (!result) return state;
      const newFocused = state.focusedPaneId === paneId ? findFirstLeaf(result) : state.focusedPaneId;
      return { root: result, focusedPaneId: newFocused };
    }

    return {
      root: updateLeaf(state.root, paneId, (leaf) => {
        const newTabs = leaf.tabs.filter((_, i) => i !== tabIndex);
        let newActive = leaf.activeTabIndex;
        if (tabIndex === leaf.activeTabIndex) {
          newActive = Math.min(tabIndex, newTabs.length - 1);
        } else if (tabIndex < leaf.activeTabIndex) {
          newActive--;
        }
        return { ...leaf, tabs: newTabs, activeTabIndex: newActive };
      }),
    };
  }),

  setActiveTab: (paneId, tabIndex) => set((state) => ({
    root: updateLeaf(state.root, paneId, (leaf) => ({
      ...leaf,
      activeTabIndex: Math.max(0, Math.min(tabIndex, leaf.tabs.length - 1)),
    })),
  })),

  cycleTab: (paneId, direction) => set((state) => {
    const leaf = findLeaf(state.root, paneId);
    if (!leaf || leaf.tabs.length <= 1) return state;
    const newIndex = (leaf.activeTabIndex + direction + leaf.tabs.length) % leaf.tabs.length;
    return {
      root: updateLeaf(state.root, paneId, (l) => ({ ...l, activeTabIndex: newIndex })),
    };
  }),

  getLeafById: (paneId) => {
    return findLeaf(get().root, paneId);
  },

  getFocusedLeaf: () => {
    return findLeaf(get().root, get().focusedPaneId);
  },

  getEditorPaneId: () => {
    const editorLeaf = findEditorLeaf(get().root);
    return editorLeaf?.id;
  },

  setRoot: (root) => set(() => {
    nextId = maxIdInTree(root) + 1;
    return { root, focusedPaneId: findFirstLeaf(root) };
  }),

  createProjectLayout: () => set(() => {
    const editorPaneId = genId();
    const terminalPaneId = genId();
    return {
      root: {
        type: 'split',
        id: genId(),
        direction: 'horizontal' as SplitDirection,
        ratio: 0.6,
        children: [
          {
            type: 'leaf',
            id: editorPaneId,
            tabs: [{ id: genTabId(), type: 'editor' as PaneType, title: 'Editor' }],
            activeTabIndex: 0,
          } as LeafNode,
          {
            type: 'leaf',
            id: terminalPaneId,
            tabs: [{ id: genTabId(), type: 'terminal' as PaneType, title: 'Terminal' }],
            activeTabIndex: 0,
          } as LeafNode,
        ],
      } as SplitNode,
      focusedPaneId: terminalPaneId,
    };
  }),
}));
