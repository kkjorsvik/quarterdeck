import React, { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useAgentStore } from '../../stores/agentStore';
import { getProjectColor } from '../../lib/projectColors';
import type { LayoutNode } from '../../lib/types';

function countTerminals(node: LayoutNode): number {
  if (node.type === 'leaf') {
    return node.tabs.filter(t => t.type === 'terminal').length;
  }
  return countTerminals(node.children[0]) + countTerminals(node.children[1]);
}

export function StatusBar() {
  const activeProject = useProjectStore(s => s.projects.find(p => p.id === s.activeProjectId));
  const root = useLayoutStore(s => s.root);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const getLeafById = useLayoutStore(s => s.getLeafById);
  const focusedLeaf = getLeafById(focusedPaneId);
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

  const allAgents = useAgentStore(s => s.agents);
  const agentList = Array.from(allAgents.values());
  const activeAgents = agentList.filter(a => ['starting', 'working', 'needs_input'].includes(a.status));
  const needsInputCount = agentList.filter(a => a.status === 'needs_input').length;
  const hasError = agentList.some(a => a.status === 'error');

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
      {activeAgents.length > 0 && (
        <span style={{
          color: hasError ? '#f87171' : needsInputCount > 0 ? '#facc15' : 'var(--text-secondary)',
        }}>
          {activeAgents.length} agent{activeAgents.length !== 1 ? 's' : ''}
          {needsInputCount > 0 && ` (${needsInputCount} needs input)`}
        </span>
      )}
      <span>⬚ {termCount}</span>
    </div>
  );
}
