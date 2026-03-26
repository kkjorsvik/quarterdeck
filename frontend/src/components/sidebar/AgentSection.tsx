import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { AgentCard } from './AgentCard';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

export function AgentSection() {
  const agents = useAgentStore(s => s.agents);
  const getActiveAgents = useAgentStore(s => s.getActiveAgents);
  const getAttentionAgents = useAgentStore(s => s.getAttentionAgents);
  const projects = useProjectStore(s => s.projects);
  const switchProject = useProjectStore(s => s.switchProject);
  const openOverlay = useOverlayStore(s => s.open);

  const [collapsed, setCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; agentId: string } | null>(null);

  // Force re-render every 10s for elapsed time updates
  const [, setTick] = useState(0);
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    tickRef.current = window.setInterval(() => setTick(t => t + 1), 10000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const allAgents = Array.from(agents.values());
  const activeAgents = getActiveAgents();
  const attentionAgents = getAttentionAgents();

  const handleAgentClick = useCallback((agent: { projectId: number }) => {
    // Switch to agent's project (best effort focus terminal tab)
    switchProject(agent.projectId);
  }, [switchProject]);

  const handleContextMenu = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, agentId });
  }, []);

  const handleStopAgent = useCallback(async (agentId: string) => {
    try {
      await (window as any).go.main.App.StopAgent(agentId);
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  }, []);

  const getProject = (id: number) => projects.find(p => p.id === id);

  // Summary for collapsed state
  const summaryText = (() => {
    if (allAgents.length === 0) return null;
    const parts = [`${activeAgents.length} agent${activeAgents.length !== 1 ? 's' : ''}`];
    if (attentionAgents.length > 0) {
      parts.push(`(${attentionAgents.length} needs input)`);
    }
    return parts.join(' ');
  })();

  const summaryColor = attentionAgents.length > 0 ? '#eab308' : 'var(--text-secondary)';

  return (
    <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
      }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px', color: 'var(--text-secondary)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            display: 'inline-block',
          }}>
            &#9662;
          </span>
          <span style={{
            fontSize: '12px', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Agents
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); openOverlay('spawnAgent'); }}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: '12px',
            borderRadius: '3px',
          }}
        >
          + New
        </button>
      </div>

      {/* Collapsed summary */}
      {collapsed && summaryText && (
        <div style={{
          padding: '2px 12px 6px 28px',
          fontSize: '11px',
          color: summaryColor,
        }}>
          {summaryText}
        </div>
      )}

      {/* Expanded agent list */}
      {!collapsed && (
        <div>
          {allAgents.length === 0 ? (
            <div style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}>
              No active agents
            </div>
          ) : (
            allAgents.map(agent => {
              const proj = getProject(agent.projectId);
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectName={proj?.name || 'Unknown'}
                  projectColor={proj?.color || '#888'}
                  onClick={() => handleAgentClick(agent)}
                  onContextMenu={(e) => handleContextMenu(e, agent.id)}
                />
              );
            })
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'Stop Agent',
              onClick: () => handleStopAgent(contextMenu.agentId),
              danger: true,
            } as ContextMenuItem,
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
