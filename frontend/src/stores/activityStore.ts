import { create } from 'zustand';

export interface ActivityEvent {
  id: number;
  eventType: string;
  agentId?: string;
  projectId?: number;
  title: string;
  detail?: string;
  createdAt: string;
}

interface ActivityStoreState {
  events: ActivityEvent[];
  addEvent: (event: ActivityEvent) => void;
  setEvents: (events: ActivityEvent[]) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityStoreState>((set) => ({
  events: [],

  addEvent: (event) => set((state) => ({
    events: [event, ...state.events].slice(0, 500),
  })),

  setEvents: (events) => set({ events: events.slice(0, 500) }),

  clear: () => set({ events: [] }),
}));
