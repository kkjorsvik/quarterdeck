import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { useActivityStore } from '../stores/activityStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { AgentStatusType } from '../lib/types';

export function useAgentEvents(wsPort: number | null) {
  const updateStatus = useAgentStore(s => s.updateStatus);
  const addAgent = useAgentStore(s => s.addAgent);
  const addActivity = useActivityStore(s => s.addEvent);
  const addNotification = useNotificationStore(s => s.add);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<number | null>(null);

  // Hydrate agent store on startup
  useEffect(() => {
    (window as any).go.main.App.ListAgents().then((agents: any[]) => {
      if (agents) {
        for (const a of agents) {
          addAgent({
            id: a.id, projectId: a.projectId, type: a.type,
            displayName: a.displayName, taskDescription: a.taskDescription,
            status: a.status, ptySessionId: a.ptySessionId,
            startedAt: a.startedAt, exitCode: a.exitCode,
          });
        }
      }
    }).catch(() => {});
  }, [addAgent]);

  useEffect(() => {
    if (!wsPort) return;

    const connect = () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws/events`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'agent_status') {
            updateStatus(msg.agentId, msg.status as AgentStatusType, msg.exitCode);

            const status = msg.status as AgentStatusType;
            if (status === 'needs_input') {
              addNotification({ type: 'warning', title: 'Agent needs input', agentId: msg.agentId });
            } else if (status === 'error') {
              addNotification({ type: 'error', title: 'Agent errored', agentId: msg.agentId });
            } else if (status === 'done') {
              addNotification({ type: 'success', title: 'Agent completed', agentId: msg.agentId });
            }
          }
          if (msg.type === 'activity' && msg.event) {
            addActivity(msg.event);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onopen = () => { reconnectDelayRef.current = 1000; };
    };

    connect();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [wsPort, updateStatus, addActivity, addNotification]);
}
