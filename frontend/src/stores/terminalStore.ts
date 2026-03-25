import { create } from 'zustand';

interface TerminalSession {
  id: string;
  paneId: string;
  projectId: number;
  command: string;
}

const wsRefs = new Map<string, WebSocket>();

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  addSession: (paneId: string, sessionId: string, projectId: number, command: string) => void;
  removeSession: (paneId: string) => void;
  setActiveSession: (sessionId: string) => void;
  getSessionByPane: (paneId: string) => TerminalSession | undefined;
  getSessionsByProject: (projectId: number) => TerminalSession[];
  clearByProject: (projectId: number) => void;
  registerWs: (paneId: string, ws: WebSocket) => void;
  getWs: (paneId: string) => WebSocket | undefined;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (paneId, sessionId, projectId, command) => set((state) => {
    const sessions = new Map(state.sessions);
    sessions.set(paneId, { id: sessionId, paneId, projectId, command });
    return { sessions, activeSessionId: sessionId };
  }),

  removeSession: (paneId) => set((state) => {
    const sessions = new Map(state.sessions);
    wsRefs.delete(paneId);
    sessions.delete(paneId);
    return { sessions };
  }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  getSessionByPane: (paneId) => {
    return get().sessions.get(paneId);
  },

  getSessionsByProject: (projectId) => {
    return Array.from(get().sessions.values()).filter(s => s.projectId === projectId);
  },

  clearByProject: (projectId) => set((state) => {
    const sessions = new Map(state.sessions);
    for (const [paneId, session] of sessions) {
      if (session.projectId === projectId) {
        wsRefs.delete(paneId);
        sessions.delete(paneId);
      }
    }
    return { sessions };
  }),

  registerWs: (paneId, ws) => {
    wsRefs.set(paneId, ws);
  },

  getWs: (paneId) => {
    return wsRefs.get(paneId);
  },
}));
