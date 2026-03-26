import { create } from 'zustand';
import type { AgentState, AgentStatusType } from '../lib/types';

interface AgentStoreState {
  agents: Map<string, AgentState>;
  addAgent: (agent: AgentState) => void;
  updateStatus: (agentId: string, status: AgentStatusType, exitCode?: number) => void;
  removeAgent: (agentId: string) => void;
  getProjectAgents: (projectId: number) => AgentState[];
  getActiveAgents: () => AgentState[];
  getAttentionAgents: () => AgentState[];
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: new Map(),

  addAgent: (agent) => set((state) => {
    const agents = new Map(state.agents);
    agents.set(agent.id, agent);
    return { agents };
  }),

  updateStatus: (agentId, status, exitCode) => set((state) => {
    const agents = new Map(state.agents);
    const agent = agents.get(agentId);
    if (agent) {
      agents.set(agentId, {
        ...agent, status,
        exitCode: exitCode !== undefined ? exitCode : agent.exitCode,
      });
    }
    return { agents };
  }),

  removeAgent: (agentId) => set((state) => {
    const agents = new Map(state.agents);
    agents.delete(agentId);
    return { agents };
  }),

  getProjectAgents: (projectId) => Array.from(get().agents.values()).filter(a => a.projectId === projectId),
  getActiveAgents: () => Array.from(get().agents.values()).filter(a => ['starting', 'working', 'needs_input'].includes(a.status)),
  getAttentionAgents: () => Array.from(get().agents.values()).filter(a => a.status === 'needs_input' || a.status === 'error'),
}));
