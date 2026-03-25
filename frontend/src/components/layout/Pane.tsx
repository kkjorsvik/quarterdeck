import React from 'react';
import type { LeafNode } from '../../lib/types';
import { PaneHeader } from './PaneHeader';
import { useLayoutStore } from '../../stores/layoutStore';
import { TerminalPanel } from '../terminal/Terminal';
import { useProjectStore } from '../../stores/projectStore';
import { MonacoEditor } from '../editor/MonacoEditor';

interface PaneProps {
  node: LeafNode;
}

export function Pane({ node }: PaneProps) {
  const setFocusedPane = useLayoutStore(s => s.setFocusedPane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const isFocused = focusedPaneId === node.id;
  const activeProject = useProjectStore(s => s.getActiveProject());

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
      <PaneHeader paneId={node.id} paneType={node.paneType} />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {node.paneType === 'editor' ? (
          <MonacoEditor />
        ) : (
          <TerminalPanel workDir={activeProject?.path || '/tmp'} />
        )}
      </div>
    </div>
  );
}
