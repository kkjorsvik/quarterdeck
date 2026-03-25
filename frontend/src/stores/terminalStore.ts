import { create } from 'zustand';

interface TerminalSession {
  id: string;
  paneId: string;
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  addSession: (paneId: string, sessionId: string) => void;
  removeSession: (paneId: string) => void;
  setActiveSession: (sessionId: string) => void;
  getSessionByPane: (paneId: string) => TerminalSession | undefined;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (paneId, sessionId) => set((state) => {
    const sessions = new Map(state.sessions);
    sessions.set(paneId, { id: sessionId, paneId });
    return { sessions, activeSessionId: sessionId };
  }),

  removeSession: (paneId) => set((state) => {
    const sessions = new Map(state.sessions);
    sessions.delete(paneId);
    return { sessions };
  }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  getSessionByPane: (paneId) => {
    return get().sessions.get(paneId);
  },
}));
