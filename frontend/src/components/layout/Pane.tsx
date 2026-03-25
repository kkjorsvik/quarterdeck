import React from 'react';
import type { LeafNode } from '../../lib/types';
import { PaneHeader } from './PaneHeader';
import { useLayoutStore } from '../../stores/layoutStore';

interface PaneProps {
  node: LeafNode;
}

export function Pane({ node }: PaneProps) {
  const setFocusedPane = useLayoutStore(s => s.setFocusedPane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const isFocused = focusedPaneId === node.id;

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
        {/* Placeholder — Terminal and Editor components plugged in during Tasks 12-13 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: '14px',
        }}>
          {node.paneType === 'terminal' ? '[ Terminal ]' : `[ Editor: ${node.filePath || 'none'} ]`}
        </div>
      </div>
    </div>
  );
}
