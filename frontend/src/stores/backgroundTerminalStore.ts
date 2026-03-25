import { create } from 'zustand';
import { RingBuffer } from '../lib/ringBuffer';

export interface BackgroundTerminal {
  sessionId: string;
  projectId: number;
  wsConnection: WebSocket;
  outputBuffer: RingBuffer<Uint8Array>;
  hasNewOutput: boolean;
  lastOutputTimestamp: number;
  exitInfo: { code: number; command: string } | null;
}

interface BackgroundTerminalState {
  terminals: Map<string, BackgroundTerminal>;

  detach: (sessionId: string, projectId: number, ws: WebSocket, command: string) => void;
  reattach: (sessionId: string) => { ws: WebSocket; buffer: Uint8Array[] } | null;

  getByProject: (projectId: number) => BackgroundTerminal[];
  hasNewOutput: (projectId: number) => boolean;
  getProjectOutputTimestamp: (projectId: number) => number | null;
  clearNewOutput: (projectId: number) => void;

  removeSession: (sessionId: string) => void;
  removeByProject: (projectId: number) => void;
}

export const useBackgroundTerminalStore = create<BackgroundTerminalState>((set, get) => ({
  terminals: new Map(),

  detach: (sessionId, projectId, ws, command) => set((state) => {
    const terminals = new Map(state.terminals);
    const bg: BackgroundTerminal = {
      sessionId,
      projectId,
      wsConnection: ws,
      outputBuffer: new RingBuffer<Uint8Array>(5000),
      hasNewOutput: false,
      lastOutputTimestamp: 0,
      exitInfo: null,
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        bg.outputBuffer.push(new Uint8Array(event.data));
        bg.hasNewOutput = true;
        bg.lastOutputTimestamp = Date.now();
        set((s) => ({ terminals: new Map(s.terminals) }));
      } else if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'exited') {
            bg.exitInfo = { code: msg.exitCode, command };
            bg.hasNewOutput = true;
            bg.lastOutputTimestamp = Date.now();
            set((s) => ({ terminals: new Map(s.terminals) }));
          }
        } catch { /* ignore */ }
      }
    };

    ws.onclose = () => {
      if (!bg.exitInfo) {
        bg.exitInfo = { code: -1, command };
      }
      set((s) => ({ terminals: new Map(s.terminals) }));
    };

    terminals.set(sessionId, bg);
    return { terminals };
  }),

  reattach: (sessionId) => {
    const state = get();
    const bg = state.terminals.get(sessionId);
    if (!bg) return null;

    const buffer = bg.outputBuffer.drain();
    const ws = bg.wsConnection;

    const terminals = new Map(state.terminals);
    terminals.delete(sessionId);
    set({ terminals });

    return { ws, buffer };
  },

  getByProject: (projectId) => {
    return Array.from(get().terminals.values()).filter(t => t.projectId === projectId);
  },

  hasNewOutput: (projectId) => {
    return Array.from(get().terminals.values()).some(
      t => t.projectId === projectId && t.hasNewOutput
    );
  },

  getProjectOutputTimestamp: (projectId) => {
    const terminals = Array.from(get().terminals.values()).filter(t => t.projectId === projectId);
    if (terminals.length === 0) return null;
    return Math.max(...terminals.map(t => t.lastOutputTimestamp));
  },

  clearNewOutput: (projectId) => set((state) => {
    const terminals = new Map(state.terminals);
    for (const [id, bg] of terminals) {
      if (bg.projectId === projectId) {
        terminals.set(id, { ...bg, hasNewOutput: false });
      }
    }
    return { terminals };
  }),

  removeSession: (sessionId) => set((state) => {
    const terminals = new Map(state.terminals);
    const bg = terminals.get(sessionId);
    if (bg) {
      bg.wsConnection.close();
      terminals.delete(sessionId);
    }
    return { terminals };
  }),

  removeByProject: (projectId) => set((state) => {
    const terminals = new Map(state.terminals);
    for (const [id, bg] of terminals) {
      if (bg.projectId === projectId) {
        bg.wsConnection.close();
        terminals.delete(id);
      }
    }
    return { terminals };
  }),
}));
