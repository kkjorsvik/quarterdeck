import React, { useMemo } from 'react';
import type { AgentState } from '../../lib/types';

const STATUS_CONFIG: Record<string, { color: string; label: string; icon?: string }> = {
  starting: { color: '#3b82f6', label: 'Starting' },
  working: { color: '#22c55e', label: 'Working' },
  needs_input: { color: '#eab308', label: 'Needs Input' },
  done: { color: '#22c55e', label: 'Done', icon: '\u2713' },
  error: { color: '#ef4444', label: 'Error' },
};

function getTypeIcon(type: string): string {
  switch (type) {
    case 'claude': return 'CC';
    case 'codex': return 'CX';
    case 'opencode': return 'OC';
    default: return type.substring(0, 2).toUpperCase();
  }
}

function elapsedTime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const secs = Math.floor((now - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

interface AgentCardProps {
  agent: AgentState;
  projectName: string;
  projectColor: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function AgentCard({ agent, projectName, projectColor, onClick, onContextMenu }: AgentCardProps) {
  const statusCfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.error;

  const needsAttention = agent.status === 'needs_input' || agent.status === 'error';
  const borderColor = agent.status === 'needs_input' ? '#eab308' : agent.status === 'error' ? '#ef4444' : 'transparent';

  const elapsed = useMemo(() => elapsedTime(agent.startedAt), [agent.startedAt]);

  const truncatedTask = agent.taskDescription.length > 35
    ? agent.taskDescription.substring(0, 35) + '...'
    : agent.taskDescription;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={agent.taskDescription || agent.displayName}
      style={{
        padding: '6px 8px 6px 10px',
        borderLeft: `3px solid ${borderColor}`,
        background: needsAttention ? 'rgba(234, 179, 8, 0.06)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          needsAttention ? 'rgba(234, 179, 8, 0.12)' : 'var(--bg-active)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          needsAttention ? 'rgba(234, 179, 8, 0.06)' : 'transparent';
      }}
    >
      {/* Type icon */}
      <span style={{
        fontSize: '10px',
        fontWeight: 700,
        color: 'var(--text-secondary)',
        background: 'var(--bg-primary)',
        borderRadius: '3px',
        padding: '2px 4px',
        flexShrink: 0,
        fontFamily: 'monospace',
      }}>
        {getTypeIcon(agent.type)}
      </span>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Status dot */}
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: statusCfg.color, flexShrink: 0,
          }} />
          <span style={{ color: statusCfg.color, fontSize: '11px', flexShrink: 0 }}>
            {statusCfg.icon || ''} {statusCfg.label}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '10px', marginLeft: 'auto', flexShrink: 0 }}>
            {elapsed}
          </span>
        </div>
        {truncatedTask && (
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: '11px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: '2px',
          }}>
            {truncatedTask}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: projectColor || 'var(--text-secondary)',
            flexShrink: 0,
          }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
            {projectName}
          </span>
        </div>
      </div>
    </div>
  );
}
