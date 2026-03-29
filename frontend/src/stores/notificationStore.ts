import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  detail?: string;
  agentId?: string;
  projectId?: number;
  timestamp: number;
  read: boolean;
}

interface NotificationStoreState {
  notifications: Notification[];
  unreadCount: number;
  showPanel: boolean;
  add: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  togglePanel: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  notifications: [],
  unreadCount: 0,
  showPanel: false,

  add: (n) => set((state) => {
    const notification: Notification = {
      ...n,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      read: false,
    };
    return {
      notifications: [notification, ...state.notifications].slice(0, 200),
      unreadCount: state.unreadCount + 1,
    };
  }),

  markAllRead: () => set((state) => ({
    notifications: state.notifications.map(n => ({ ...n, read: true })),
    unreadCount: 0,
  })),

  dismiss: (id) => set((state) => {
    const target = state.notifications.find(n => n.id === id);
    const wasUnread = target && !target.read;
    return {
      notifications: state.notifications.filter(n => n.id !== id),
      unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
    };
  }),

  togglePanel: () => set((state) => ({ showPanel: !state.showPanel })),

  clear: () => set({ notifications: [], unreadCount: 0, showPanel: false }),
}));
