import React, { useEffect } from 'react';
import { useActivityStore } from '../../stores/activityStore';
import { useProjectStore } from '../../stores/projectStore';
import type { ActivityEvent } from '../../stores/activityStore';

const EVENT_ICONS: Record<string, string> = {
  agent_spawned: '\u25B6',
  agent_status_change: '\u25CF',
  agent_completed: '\u2713',
  agent_error: '\u2715',
};

const EVENT_COLORS: Record<string, string> = {
  agent_spawned: '#60a5fa',
  agent_status_change: '#888',
  agent_completed: '#34d399',
  agent_error: '#f87171',
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ActivityFeed() {
  const events = useActivityStore(s => s.events);
  const setEvents = useActivityStore(s => s.setEvents);
  const projects = useProjectStore(s => s.projects);

  useEffect(() => {
    (window as any).go.main.App.ListActivityEvents(200, 0)
      .then((result: ActivityEvent[] | null) => {
        if (result) setEvents(result);
      })
      .catch(() => {});
  }, [setEvents]);

  const getProjectName = (projectId?: number) => {
    if (!projectId) return null;
    const project = projects.find(p => p.id === projectId);
    return project?.name || null;
  };

  if (events.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#888',
        padding: 32,
        textAlign: 'center',
        fontSize: 14,
      }}>
        No activity yet. Spawn an agent to see events here.
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '8px 0',
    }}>
      {events.map((event) => {
        const icon = EVENT_ICONS[event.eventType] || '\u25CF';
        const color = EVENT_COLORS[event.eventType] || '#888';
        const projectName = getProjectName(event.projectId);

        return (
          <div
            key={event.id}
            style={{
              display: 'flex',
              gap: 10,
              padding: '6px 12px',
              borderBottom: '1px solid var(--border, #333)',
              alignItems: 'flex-start',
              fontSize: 13,
            }}
          >
            <span style={{ color, fontSize: 14, lineHeight: '20px', flexShrink: 0, width: 18, textAlign: 'center' }}>
              {icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#e0e0e0', lineHeight: '20px' }}>
                {event.title}
              </div>
              {event.detail && (
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                  {event.detail}
                </div>
              )}
              <div style={{ color: '#666', fontSize: 11, marginTop: 2, display: 'flex', gap: 8 }}>
                {projectName && <span>{projectName}</span>}
                <span>{relativeTime(event.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
