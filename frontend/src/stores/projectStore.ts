import { create } from 'zustand';
import type { Project, ProjectLayout, TerminalPositionSnapshot, UpdateFields, FileStatus } from '../lib/types';
import { useLayoutStore } from './layoutStore';
import { useTerminalStore } from './terminalStore';
import { useBackgroundTerminalStore } from './backgroundTerminalStore';

interface ProjectState {
  projects: Project[];
  activeProjectId: number | null;
  projectLayouts: Map<number, ProjectLayout>;
  projectBranches: Map<number, string>;
  gitStatusMap: Map<string, FileStatus>;
  isSwitching: boolean;

  loadProjects: () => Promise<void>;
  addProject: (name: string, path: string) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  updateProject: (id: number, fields: UpdateFields) => Promise<void>;
  setActiveProject: (id: number) => void;
  getActiveProject: () => Project | undefined;
  switchProject: (id: number) => Promise<void>;
  saveCurrentLayout: () => void;
  restoreLayout: (projectId: number) => Promise<void>;
  pollBranches: () => Promise<void>;
  pollGitStatus: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  loadSavedLayouts: () => Promise<void>;
  persistLayout: (projectId: number) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  projectLayouts: new Map(),
  projectBranches: new Map(),
  gitStatusMap: new Map(),
  isSwitching: false,

  loadProjects: async () => {
    try {
      const projects = await window.go.main.App.ListProjects();
      set({ projects: projects || [] });
      const state = get();
      if (!state.activeProjectId && projects && projects.length > 0) {
        set({ activeProjectId: projects[0].id });
        useLayoutStore.getState().createProjectLayout();
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

      // Clean up background terminals for the deleted project
      useBackgroundTerminalStore.getState().removeByProject(id);

      // Clean up saved layout
      const layouts = new Map(get().projectLayouts);
      layouts.delete(id);
      set({ projectLayouts: layouts });

      const state = get();
      if (state.activeProjectId === id) {
        set({ activeProjectId: null });
      }
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  },

  updateProject: async (id, fields) => {
    try {
      await window.go.main.App.UpdateProject(id, JSON.stringify(fields));
      await get().loadProjects();
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  },

  setActiveProject: (id) => {
    const wasNull = get().activeProjectId === null;
    set({ activeProjectId: id });
    if (wasNull) {
      useLayoutStore.getState().createProjectLayout();
    }
  },

  getActiveProject: () => {
    const state = get();
    return state.projects.find(p => p.id === state.activeProjectId);
  },

  switchProject: async (id) => {
    const state = get();
    if (state.isSwitching) return;
    if (state.activeProjectId === id) return;

    set({ isSwitching: true });
    try {
      const oldProjectId = state.activeProjectId;

      // 1. Save current layout
      if (oldProjectId !== null) {
        get().saveCurrentLayout();

        // 2. Persist to SQLite
        await get().persistLayout(oldProjectId);

        // 3. Detach terminals: emit custom event, yield, then move WS connections
        window.dispatchEvent(new CustomEvent('quarterdeck:detach-terminals'));
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        const terminalStore = useTerminalStore.getState();
        const bgStore = useBackgroundTerminalStore.getState();
        const sessions = terminalStore.getSessionsByProject(oldProjectId);
        for (const session of sessions) {
          const ws = terminalStore.getWs(session.paneId);
          if (ws) {
            bgStore.detach(session.id, session.projectId, ws, session.command);
          }
        }

        // 4. Clear foreground terminal state for old project
        terminalStore.clearByProject(oldProjectId);
      }

      // 5. Set new activeProjectId
      set({ activeProjectId: id });

      // 6. Clear new output flag for target project
      useBackgroundTerminalStore.getState().clearNewOutput(id);

      // 7. Restore target layout
      await get().restoreLayout(id);
    } finally {
      set({ isSwitching: false });
    }
  },

  saveCurrentLayout: () => {
    const state = get();
    if (state.activeProjectId === null) return;

    const layoutStore = useLayoutStore.getState();
    const terminalStore = useTerminalStore.getState();

    // Snapshot terminal positions
    const terminalPositions: TerminalPositionSnapshot[] = [];
    const sessions = state.activeProjectId !== null
      ? terminalStore.getSessionsByProject(state.activeProjectId)
      : [];
    for (const session of sessions) {
      terminalPositions.push({
        sessionId: session.id,
        paneId: session.paneId,
        tabIndex: 0,
      });
    }

    const layout: ProjectLayout = {
      projectId: state.activeProjectId,
      tilingTree: layoutStore.root,
      terminalPositions,
    };

    const layouts = new Map(state.projectLayouts);
    layouts.set(state.activeProjectId, layout);
    set({ projectLayouts: layouts });
  },

  restoreLayout: async (projectId) => {
    const state = get();
    const layout = state.projectLayouts.get(projectId);
    const layoutStore = useLayoutStore.getState();

    if (!layout) {
      // No saved layout — create default
      layoutStore.createProjectLayout();
      return;
    }

    // Restore tiling tree
    layoutStore.setRoot(layout.tilingTree);
    // Terminal reattachment is handled by terminal components on mount
  },

  pollBranches: async () => {
    const state = get();
    const branches = new Map(state.projectBranches);

    for (const project of state.projects) {
      try {
        const branch = await window.go.main.App.GetGitBranch(project.path);
        branches.set(project.id, branch);
      } catch {
        // Ignore errors for individual projects
      }
    }

    set({ projectBranches: branches });
  },

  loadSavedLayouts: async () => {
    try {
      const rawLayouts = await window.go.main.App.GetAllLayouts();
      const layouts = new Map<number, ProjectLayout>();

      for (const entry of rawLayouts) {
        try {
          const layout = JSON.parse(entry.layoutJson) as ProjectLayout;
          layouts.set(entry.projectId, layout);
        } catch {
          console.warn(`Failed to parse layout for project ${entry.projectId}`);
        }
      }

      set({ projectLayouts: layouts });
    } catch (err) {
      console.error('Failed to load saved layouts:', err);
    }
  },

  persistLayout: async (projectId) => {
    const layout = get().projectLayouts.get(projectId);
    if (!layout) return;

    try {
      await window.go.main.App.SaveLayout(projectId, JSON.stringify(layout));
    } catch (err) {
      console.error(`Failed to persist layout for project ${projectId}:`, err);
    }
  },

  pollGitStatus: async () => {
    const state = get();
    if (state.activeProjectId === null) return;

    try {
      const statuses: FileStatus[] = await (window as any).go.main.App.GetGitStatus(state.activeProjectId);
      const map = new Map<string, FileStatus>();
      for (const s of (statuses || [])) {
        map.set(s.path, s);
      }
      set({ gitStatusMap: map });
    } catch {
      // Ignore errors — project may not be a git repo
    }
  },

  refreshGitStatus: async () => {
    await get().pollGitStatus();
  },
}));
