import React, { useEffect, useRef, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import type { AgentState } from '../../lib/types';

function MiniTerminal({ agent, wsPort }: { agent: AgentState; wsPort: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const projects = useProjectStore(s => s.projects);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const addTab = useLayoutStore(s => s.addTab);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  const project = projects.find(p => p.id === agent.projectId);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize: 8,
      fontFamily: 'JetBrains Mono, monospace',
      scrollback: 200,
      disableStdin: true,
      cursorBlink: false,
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit after a short delay to let the DOM settle
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    ro.observe(el);
    observerRef.current = ro;

    // Connect WebSocket
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws/pty/${agent.ptySessionId}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else if (typeof ev.data === 'string') {
        // Could be an exit message — ignore for minimap
      }
    };

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
      observerRef.current = null;
    };
  }, [agent.ptySessionId, wsPort]);

  const statusColor =
    agent.status === 'working' ? '#4ade80' :
    agent.status === 'needs_input' ? '#facc15' :
    agent.status === 'starting' ? '#60a5fa' :
    '#888';

  const handleClick = () => {
    setActiveProject(agent.projectId);
    addTab(focusedPaneId, {
      type: 'terminal',
      title: agent.displayName,
      terminalId: agent.ptySessionId,
    });
  };

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        minHeight: 0,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--bg-secondary, #1e1e2e)',
        fontSize: 11,
        color: '#ccc',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.displayName}
        </span>
        {project && (
          <span style={{ opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
    </div>
  );
}

export function MultiTerminalOverview() {
  const [wsPort, setWsPort] = React.useState<number | null>(null);
  const getActiveAgents = useAgentStore(s => s.getActiveAgents);
  const agents = useAgentStore(s => s.agents); // subscribe to changes

  useEffect(() => {
    (window as any).go.main.App.GetWSPort()
      .then((port: number) => setWsPort(port))
      .catch(() => {});
  }, []);

  const activeAgents = useMemo(() => getActiveAgents(), [agents]);

  const gridCols = activeAgents.length <= 2 ? 1 : activeAgents.length <= 4 ? 2 : 3;

  if (!wsPort) {
    return (
      <div style={{ padding: 24, color: '#888', textAlign: 'center' }}>
        Connecting...
      </div>
    );
  }

  if (activeAgents.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#888',
        fontSize: 14,
        padding: 24,
      }}>
        No active agents. Spawn an agent to see terminals here.
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
      gap: 8,
      padding: 8,
      height: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
    }}>
      {activeAgents.map(agent => (
        <MiniTerminal key={agent.ptySessionId} agent={agent} wsPort={wsPort} />
      ))}
    </div>
  );
}
