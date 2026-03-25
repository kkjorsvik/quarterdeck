import React, { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { getProjectColor } from '../../lib/projectColors';
import type { LayoutNode } from '../../lib/types';

function countTerminals(node: LayoutNode): number {
  if (node.type === 'leaf') {
    return node.tabs.filter(t => t.type === 'terminal').length;
  }
  return countTerminals(node.children[0]) + countTerminals(node.children[1]);
}

export function StatusBar() {
  const activeProject = useProjectStore(s => s.getActiveProject());
  const root = useLayoutStore(s => s.root);
  const focusedLeaf = useLayoutStore(s => s.getFocusedLeaf());
  const [branch, setBranch] = useState('');

  useEffect(() => {
    if (activeProject?.path) {
      window.go.main.App.GetGitBranch(activeProject.path)
        .then(setBranch)
        .catch(() => setBranch(''));
    } else {
      setBranch('');
    }
  }, [activeProject?.path]);

  const projectColor = activeProject
    ? getProjectColor(activeProject.sortOrder, activeProject.color || null)
    : undefined;

  const termCount = countTerminals(root);
  const activeTab = focusedLeaf?.tabs[focusedLeaf.activeTabIndex];
  const currentFile = activeTab?.type === 'editor' ? activeTab.filePath?.split('/').pop() : null;

  return (
    <div style={{
      height: '24px',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: '16px',
      fontSize: '11px',
      color: 'var(--text-secondary)',
      flexShrink: 0,
    }}>
      {activeProject && (
        <span style={{ color: projectColor || 'var(--text-primary)' }}>{activeProject.name}</span>
      )}
      {branch && (
        <span>⎇ {branch}</span>
      )}
      <span style={{ flex: 1 }} />
      {currentFile && <span>{currentFile}</span>}
      <span>⬚ {termCount}</span>
    </div>
  );
}
