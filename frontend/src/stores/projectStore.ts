import { create } from 'zustand';
import type { Project } from '../lib/types';

interface ProjectState {
  projects: Project[];
  activeProjectId: number | null;

  loadProjects: () => Promise<void>;
  addProject: (name: string, path: string) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  setActiveProject: (id: number) => void;
  getActiveProject: () => Project | undefined;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    try {
      const projects = await window.go.main.App.ListProjects();
      set({ projects: projects || [] });
      // Auto-select first project if none active
      const state = get();
      if (!state.activeProjectId && projects && projects.length > 0) {
        set({ activeProjectId: projects[0].id });
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  },

  addProject: async (name, path) => {
    try {
      await window.go.main.App.AddProject(name, path);
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  },

  deleteProject: async (id) => {
    try {
      await window.go.main.App.DeleteProject(id);
      const state = get();
      if (state.activeProjectId === id) {
        set({ activeProjectId: null });
      }
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  getActiveProject: () => {
    const state = get();
    return state.projects.find(p => p.id === state.activeProjectId);
  },
}));
