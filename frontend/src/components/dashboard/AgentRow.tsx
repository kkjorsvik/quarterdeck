import React, { useEffect, useState } from 'react';
import type { AgentState, AgentStatusType } from '../../lib/types';

const STATUS_COLORS: Record<AgentStatusType, string> = {
  starting: '#60a5fa',
  working: '#34d399',
  needs_input: '#facc15',
  done: '#9ca3af',
  error: '#f87171',
};

const STATUS_LABELS: Record<AgentStatusType, string> = {
  starting: 'Starting',
  working: 'Working',
  needs_input: 'Needs Input',
  done: 'Done',
  error: 'Error',
};

function formatElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

interface AgentRowProps {
  agent: AgentState;
  projectColor?: string;
  projectName?: string;
  onJumpToTerminal: (agent: AgentState) => void;
  onStop: (agentId: string) => void;
  onRerun: (agent: AgentState) => void;
}

export function AgentRow({ agent, projectColor, projectName, onJumpToTerminal, onStop, onRerun }: AgentRowProps) {
  const [, setTick] = useState(0);
  const isActive = ['starting', 'working', 'needs_input'].includes(agent.status);

  // Auto-update elapsed time every 10s for active agents
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, [isActive]);

  const color = STATUS_COLORS[agent.status];
  const isNeedsInput = agent.status === 'needs_input';

  return (
    <div
      onClick={() => onJumpToTerminal(agent)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        backgroundColor: isNeedsInput ? 'rgba(250, 204, 21, 0.08)' : 'transparent',
        transition: 'background-color 0.15s',
      }}
      onMouseEnter={e => {
        if (!isNeedsInput) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.03)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = isNeedsInput ? 'rgba(250, 204, 21, 0.08)' : 'transparent';
      }}
    >
      {/* Status dot */}
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }} />

      {/* Status label */}
      <span style={{ color, fontSize: 12, fontWeight: 600, width: 80, flexShrink: 0 }}>
        {STATUS_LABELS[agent.status]}
      </span>

      {/* Elapsed time */}
      <span style={{ color: '#888', fontSize: 12, width: 50, flexShrink: 0, textAlign: 'right' }}>
        {formatElapsed(agent.startedAt)}
      </span>

      {/* Project name */}
      {projectName && (
        <span style={{
          color: projectColor || '#aaa',
          fontSize: 12,
          fontWeight: 500,
          width: 100,
          flexShrink: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {projectName}
        </span>
      )}

      {/* Task description */}
      <span style={{
        flex: 1,
        color: '#ccc',
        fontSize: 13,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {agent.taskDescription || agent.displayName}
      </span>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {isActive && (
          <button
            onClick={() => onStop(agent.id)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              background: 'rgba(248, 113, 113, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}
        {(agent.status === 'done' || agent.status === 'error') && (
          <button
            onClick={() => onRerun(agent)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              background: 'rgba(96, 165, 250, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(96, 165, 250, 0.3)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Re-run
          </button>
        )}
      </div>
    </div>
  );
}
