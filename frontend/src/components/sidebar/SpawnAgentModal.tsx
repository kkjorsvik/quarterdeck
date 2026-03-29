import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useOverlayStore } from '../../stores/overlayStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAgentStore } from '../../stores/agentStore';
import { useLayoutStore } from '../../stores/layoutStore';
import type { AgentState, FileStatus } from '../../lib/types';

const AGENT_TYPES = [
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'custom', label: 'Custom' },
];

export function SpawnAgentModal() {
  const active = useOverlayStore(s => s.active);
  const close = useOverlayStore(s => s.close);
  const projects = useProjectStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const switchProject = useProjectStore(s => s.switchProject);
  const addAgent = useAgentStore(s => s.addAgent);
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const [agentType, setAgentType] = useState('claude_code');
  const [taskDesc, setTaskDesc] = useState('');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [workDir, setWorkDir] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [useWorktree, setUseWorktree] = useState(false);
  const [dirtyFiles, setDirtyFiles] = useState<FileStatus[]>([]);
  const [stashing, setStashing] = useState(false);

  // Read agents from store for auto-check logic
  const agentMap = useAgentStore(s => s.agents);
  const refreshGitStatus = useProjectStore(s => s.refreshGitStatus);

  const hasActiveProjectAgents = useMemo(() => {
    if (projectId === null) return false;
    return Array.from(agentMap.values()).some(
      a => a.projectId === projectId && ['starting', 'working', 'needs_input'].includes(a.status)
    );
  }, [agentMap, projectId]);

  // Reset form when modal opens
  useEffect(() => {
    if (active === 'spawnAgent') {
      setAgentType('claude');
      setTaskDesc('');
      setProjectId(activeProjectId);
      setCustomCmd('');
      setError('');
      setLaunching(false);
      setUseWorktree(false);
      setDirtyFiles([]);
      setStashing(false);
      // Set default workDir from active project
      const proj = projects.find(p => p.id === activeProjectId);
      setWorkDir(proj?.path || '');
      // Check git status on open
      if (activeProjectId) {
        (window as any).go.main.App.GetGitStatus(activeProjectId)
          .then((statuses: FileStatus[]) => setDirtyFiles(statuses || []))
          .catch(() => setDirtyFiles([]));
      }
    }
  }, [active, activeProjectId, projects]);

  // Auto-check worktree when project has active agents
  useEffect(() => {
    if (active === 'spawnAgent' && hasActiveProjectAgents) {
      setUseWorktree(true);
    }
  }, [active, hasActiveProjectAgents]);

  // Update workDir when project selection changes
  useEffect(() => {
    if (active === 'spawnAgent' && projectId !== null) {
      const proj = projects.find(p => p.id === projectId);
      if (proj) setWorkDir(proj.path);
    }
  }, [projectId, active, projects]);

  const handleStashNow = useCallback(async () => {
    if (projectId === null) return;
    setStashing(true);
    try {
      await (window as any).go.main.App.StashPush(projectId, 'Auto-stash before agent spawn');
      setDirtyFiles([]);
      await refreshGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setStashing(false);
    }
  }, [projectId, refreshGitStatus]);

  const handleLaunch = useCallback(async () => {
    if (launching) return;
    if (projectId === null) {
      setError('Select a project');
      return;
    }
    setError('');
    setLaunching(true);

    let effectiveWorkDir = workDir;
    let worktreePath: string | null = null;

    try {
      // Create worktree if requested
      if (useWorktree) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const rand = Math.random().toString(36).slice(2, 6);
        const branchName = `agent/${agentType}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}-${rand}`;
        try {
          const wtPath: string = await (window as any).go.main.App.CreateWorktree(projectId, branchName);
          worktreePath = wtPath;
          effectiveWorkDir = wtPath;
        } catch (err: any) {
          setError('Worktree creation failed: ' + (err?.message || String(err)));
          setLaunching(false);
          return;
        }
      }

      const result = await (window as any).go.main.App.SpawnAgent(
        projectId, agentType, taskDesc, effectiveWorkDir, agentType === 'custom' ? customCmd : ''
      ).catch(async (err: any) => {
        // Clean up worktree on spawn failure
        if (worktreePath) {
          try { await (window as any).go.main.App.RemoveWorktree(projectId, worktreePath, true); } catch {}
        }
        throw err;
      });
      // Add to agent store
      const proj = projects.find(p => p.id === projectId);
      const displayName = agentType === 'custom' ? customCmd.split('/').pop() || 'Custom' :
        AGENT_TYPES.find(t => t.value === agentType)?.label || agentType;
      addAgent({
        id: result.agentId,
        projectId: projectId,
        type: agentType,
        displayName,
        taskDescription: taskDesc,
        status: 'starting',
        ptySessionId: result.ptySessionId,
        startedAt: new Date().toISOString(),
        exitCode: null,
      } as AgentState);

      // Switch to the agent's project first (if different), then add the terminal tab
      if (projectId !== activeProjectId) {
        await switchProject(projectId);
      }

      const title = taskDesc
        ? `[${displayName}] ${taskDesc.substring(0, 30)}`
        : `[${displayName}]`;
      // Get the current focused pane after project switch (layout may have changed)
      const currentFocusedPane = useLayoutStore.getState().focusedPaneId;
      addTab(currentFocusedPane, {
        type: 'terminal',
        title,
        terminalId: result.ptySessionId,
      });
      close();
    } catch (err: any) {
      setError(err?.message || String(err) || 'Failed to spawn agent');
    } finally {
      setLaunching(false);
    }
  }, [launching, projectId, agentType, taskDesc, workDir, customCmd, projects, addAgent, addTab, focusedPaneId, close, activeProjectId, switchProject, useWorktree]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleLaunch();
    }
  }, [close, handleLaunch]);

  if (active !== 'spawnAgent') return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={handleKeyDown}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '20px',
        width: '420px',
        maxWidth: '90vw',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Spawn Agent
        </div>

        {/* Agent type */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {AGENT_TYPES.map(t => (
            <label key={t.value} style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="agentType"
                value={t.value}
                checked={agentType === t.value}
                onChange={() => setAgentType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </div>

        {/* Custom command */}
        {agentType === 'custom' && (
          <input
            type="text"
            placeholder="Command (e.g. /usr/bin/my-agent)"
            value={customCmd}
            onChange={e => setCustomCmd(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        )}

        {/* Task description */}
        <textarea
          placeholder="Task description (optional)"
          value={taskDesc}
          onChange={e => setTaskDesc(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />

        {/* Project */}
        <select
          value={projectId ?? ''}
          onChange={e => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={inputStyle}
        >
          <option value="">Select project...</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Working directory */}
        <input
          type="text"
          placeholder="Working directory"
          value={workDir}
          onChange={e => setWorkDir(e.target.value)}
          style={inputStyle}
        />

        {/* Worktree isolation */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={e => setUseWorktree(e.target.checked)}
          />
          Isolate in worktree
        </label>
        {useWorktree && hasActiveProjectAgents && (
          <div style={{ fontSize: '11px', color: '#facc15', padding: '0 4px' }}>
            Auto-enabled: project has active agents running.
          </div>
        )}

        {/* Dirty tree warning */}
        {dirtyFiles.length > 0 && !useWorktree && (
          <div style={{
            fontSize: '11px', color: '#facc15', padding: '6px 8px',
            background: 'rgba(250, 204, 21, 0.1)', borderRadius: '4px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span>Working tree has {dirtyFiles.length} uncommitted change{dirtyFiles.length !== 1 ? 's' : ''}.</span>
            <button
              onClick={handleStashNow}
              disabled={stashing}
              style={{
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                borderRadius: '3px', padding: '2px 8px', fontSize: '11px',
                color: 'var(--text-primary)', cursor: 'pointer',
                opacity: stashing ? 0.5 : 1,
              }}
            >
              {stashing ? 'Stashing...' : 'Stash Now'}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: '12px', color: '#f87171', padding: '4px 0' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={close} style={buttonStyle}>Cancel</button>
          <button
            onClick={handleLaunch}
            disabled={launching}
            style={{
              ...buttonStyle,
              background: 'var(--accent, #3b82f6)',
              color: '#fff',
              opacity: launching ? 0.6 : 1,
            }}
          >
            {launching ? 'Launching...' : 'Launch'}
          </button>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          Ctrl+Enter to launch, Escape to cancel
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '13px',
  color: 'var(--text-primary)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '6px 16px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};
