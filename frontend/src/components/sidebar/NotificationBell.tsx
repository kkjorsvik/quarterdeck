import React, { useEffect, useRef } from 'react';
import { useNotificationStore } from '../../stores/notificationStore';
import type { Notification } from '../../stores/notificationStore';

const TYPE_COLORS: Record<Notification['type'], string> = {
  info: '#60a5fa',
  warning: '#facc15',
  error: '#f87171',
  success: '#34d399',
};

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell() {
  const notifications = useNotificationStore(s => s.notifications);
  const unreadCount = useNotificationStore(s => s.unreadCount);
  const showPanel = useNotificationStore(s => s.showPanel);
  const togglePanel = useNotificationStore(s => s.togglePanel);
  const markAllRead = useNotificationStore(s => s.markAllRead);
  const dismiss = useNotificationStore(s => s.dismiss);

  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        togglePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPanel, togglePanel]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={bellRef}
        onClick={togglePanel}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          padding: '6px 12px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
        }}
      >
        <span style={{ fontSize: '14px' }}>{'\u266A'}</span>
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span style={{
            background: '#f87171',
            color: '#fff',
            borderRadius: '8px',
            padding: '0 5px',
            fontSize: '10px',
            fontWeight: 700,
            lineHeight: '16px',
            minWidth: '16px',
            textAlign: 'center',
            marginLeft: 'auto',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showPanel && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            width: '248px',
            maxHeight: '360px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
            boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Notifications
            </span>
            <button
              onClick={markAllRead}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 4px',
              }}
            >
              Mark all read
            </button>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
                No notifications
              </div>
            )}
            {notifications.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  background: n.read ? 'transparent' : 'rgba(255,255,255,0.03)',
                }}
              >
                {/* Type dot */}
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: TYPE_COLORS[n.type],
                  flexShrink: 0,
                  marginTop: '4px',
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.3' }}>
                    {n.title}
                  </div>
                  {n.detail && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.3' }}>
                      {n.detail}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {relativeTime(n.timestamp)}
                  </div>
                </div>

                {/* Dismiss button */}
                <button
                  onClick={() => dismiss(n.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '0 2px',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {'\u00d7'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
