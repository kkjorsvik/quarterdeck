import React from 'react';
import type { LeafNode } from '../../lib/types';
import { TabBar } from './TabBar';
import { useLayoutStore } from '../../stores/layoutStore';
import { TerminalPanel } from '../terminal/Terminal';
import { useProjectStore } from '../../stores/projectStore';
import { MonacoEditor } from '../editor/MonacoEditor';
import { ProjectSettings } from '../settings/ProjectSettings';
import { RunHistory } from '../review/RunHistory';
import { RunReview } from '../review/RunReview';
import { WorkingTreeDiff } from '../review/WorkingTreeDiff';

interface PaneProps {
  node: LeafNode;
}

export function Pane({ node }: PaneProps) {
  const setFocusedPane = useLayoutStore(s => s.setFocusedPane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const isFocused = focusedPaneId === node.id;
  const activeProject = useProjectStore(s => s.projects.find(p => p.id === s.activeProjectId));

  return (
    <div
      className={`pane ${isFocused ? 'pane-focused' : ''}`}
      onClick={() => setFocusedPane(node.id)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        border: isFocused ? '1px solid var(--accent)' : '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <TabBar paneId={node.id} tabs={node.tabs} activeTabIndex={node.activeTabIndex} />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {node.tabs.map((tab, i) => (
          <div
            key={tab.id}
            style={{
              display: i === node.activeTabIndex ? 'flex' : 'none',
              width: '100%',
              height: '100%',
            }}
          >
            {tab.type === 'terminal' ? (
              <TerminalPanel workDir={activeProject?.path || '/tmp'} existingSessionId={tab.terminalId} />
            ) : tab.type === 'settings' && tab.projectId ? (
              <ProjectSettings projectId={tab.projectId} />
            ) : tab.type === 'runHistory' && tab.projectId ? (
              <RunHistory projectId={tab.projectId} />
            ) : tab.type === 'review' && tab.runId && tab.projectId ? (
              <RunReview runId={tab.runId} projectId={tab.projectId} />
            ) : tab.type === 'workingTree' && tab.projectId ? (
              <WorkingTreeDiff projectId={tab.projectId} />
            ) : (
              <MonacoEditor filePath={tab.filePath} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
