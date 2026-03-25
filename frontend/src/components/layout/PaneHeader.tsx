import React from 'react';
import type { PaneType } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';

interface PaneHeaderProps {
  paneId: string;
  paneType: PaneType;
  title?: string;
}

export function PaneHeader({ paneId, paneType, title }: PaneHeaderProps) {
  const closePane = useLayoutStore(s => s.closePane);

  const label = title || (paneType === 'terminal' ? 'Terminal' : 'Editor');

  return (
    <div className="pane-header" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 8px',
      height: '28px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      fontSize: '12px',
      color: 'var(--text-secondary)',
      flexShrink: 0,
    }}>
      <span>{label}</span>
      <button
        onClick={() => closePane(paneId)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          padding: '0 4px',
          fontSize: '14px',
          lineHeight: 1,
        }}
        title="Close pane"
      >
        ×
      </button>
    </div>
  );
}
