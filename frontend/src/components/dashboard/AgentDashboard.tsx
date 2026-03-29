import React, { useMemo, useState, useCallback } from 'react';
import type { AgentState, AgentStatusType } from '../../lib/types';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { AgentRow } from './AgentRow';

type FilterType = 'all' | 'active' | 'needs_input' | 'error' | 'done';
type SortType = 'status' | 'project' | 'time';

const STATUS_PRIORITY: Record<AgentStatusType, number> = {
  needs_input: 0,
  error: 1,
  working: 2,
  starting: 3,
  done: 4,
};

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'needs_input', label: 'Needs Input' },
  { key: 'error', label: 'Error' },
  { key: 'done', label: 'Done' },
];

export function AgentDashboard() {
  const agents = useAgentStore(s => s.agents);
  const projects = useProjectStore(s => s.projects);
  const switchProject = useProjectStore(s => s.switchProject);
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const toggleOverlay = useOverlayStore(s => s.toggle);

  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('status');

  const allAgents = useMemo(() => Array.from(agents.values()), [agents]);

  const projectMap = useMemo(() => {
    const map = new Map<number, { name: string; color: string }>();
    for (const p of projects) {
      map.set(p.id, { name: p.name, color: p.color });
    }
    return map;
  }, [projects]);

  const counts = useMemo(() => {
    const c = { all: allAgents.length, active: 0, needs_input: 0, error: 0, done: 0 };
    for (const a of allAgents) {
      if (['starting', 'working', 'needs_input'].includes(a.status)) c.active++;
      if (a.status === 'needs_input') c.needs_input++;
      if (a.status === 'error') c.error++;
      if (a.status === 'done') c.done++;
    }
    return c;
  }, [allAgents]);

  const filtered = useMemo(() => {
    let list = allAgents;
    switch (filter) {
      case 'active':
        list = list.filter(a => ['starting', 'working', 'needs_input'].includes(a.status));
        break;
      case 'needs_input':
        list = list.filter(a => a.status === 'needs_input');
        break;
      case 'error':
        list = list.filter(a => a.status === 'error');
        break;
      case 'done':
        list = list.filter(a => a.status === 'done');
        break;
    }

    const sorted = [...list];
    switch (sort) {
      case 'status':
        sorted.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
        break;
      case 'project':
        sorted.sort((a, b) => {
          const pa = projectMap.get(a.projectId)?.name || '';
          const pb = projectMap.get(b.projectId)?.name || '';
          return pa.localeCompare(pb);
        });
        break;
      case 'time':
        sorted.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        break;
    }
    return sorted;
  }, [allAgents, filter, sort, projectMap]);

  const handleJumpToTerminal = useCallback(async (agent: AgentState) => {
    await switchProject(agent.projectId);
    addTab(focusedPaneId, { type: 'terminal', title: agent.displayName || 'Agent', terminalId: agent.ptySessionId });
  }, [switchProject, addTab, focusedPaneId]);

  const handleStop = useCallback((agentId: string) => {
    (window as any).go.main.App.StopAgent(agentId).catch(() => {});
  }, []);

  const handleRerun = useCallback(async (agent: AgentState) => {
    await switchProject(agent.projectId);
    toggleOverlay('spawnAgent');
  }, [switchProject, toggleOverlay]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
                background: filter === opt.key ? 'var(--accent)' : 'transparent',
                color: filter === opt.key ? '#fff' : '#aaa',
              }}
            >
              {opt.label} ({counts[opt.key]})
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#666' }}>Sort:</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortType)}
            style={{
              fontSize: 12,
              padding: '2px 6px',
              background: 'var(--bg-secondary, #1e1e1e)',
              color: '#ccc',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            <option value="status">Status</option>
            <option value="project">Project</option>
            <option value="time">Time</option>
          </select>
        </div>
      </div>

      {/* Agent list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: 14,
          }}>
            {allAgents.length === 0
              ? 'No agents running. Press Ctrl+Shift+A to spawn one.'
              : 'No agents match the current filter.'}
          </div>
        ) : (
          filtered.map(agent => {
            const proj = projectMap.get(agent.projectId);
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                projectName={proj?.name}
                projectColor={proj?.color}
                onJumpToTerminal={handleJumpToTerminal}
                onStop={handleStop}
                onRerun={handleRerun}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
