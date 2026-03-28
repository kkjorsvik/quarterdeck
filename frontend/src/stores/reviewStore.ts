import { create } from 'zustand';

type FileDecision = 'pending' | 'accepted' | 'rejected';

interface ReviewState {
  runId: number | null;
  projectId: number | null;
  runInfo: { agentType: string; taskDescription: string; baseCommit: string; endCommit: string } | null;
  fileDecisions: Map<string, FileDecision>;
  activeFilePath: string | null;
  diffMode: 'side-by-side' | 'inline';

  setRun: (runId: number, projectId: number, info?: ReviewState['runInfo']) => void;
  setDecision: (fp: string, d: FileDecision) => void;
  setActiveFile: (fp: string) => void;
  toggleDiffMode: () => void;
  acceptAll: (fps: string[]) => void;
  rejectAll: (fps: string[]) => void;
  getAcceptedFiles: () => string[];
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  runId: null,
  projectId: null,
  runInfo: null,
  fileDecisions: new Map(),
  activeFilePath: null,
  diffMode: 'side-by-side',

  setRun: (runId, projectId, info) => set({
    runId,
    projectId,
    runInfo: info ?? null,
    fileDecisions: new Map(),
    activeFilePath: null,
  }),

  setDecision: (fp, d) => set((state) => {
    const decisions = new Map(state.fileDecisions);
    decisions.set(fp, d);
    return { fileDecisions: decisions };
  }),

  setActiveFile: (fp) => set({ activeFilePath: fp }),

  toggleDiffMode: () => set((state) => ({
    diffMode: state.diffMode === 'side-by-side' ? 'inline' : 'side-by-side',
  })),

  acceptAll: (fps) => set((state) => {
    const decisions = new Map(state.fileDecisions);
    for (const fp of fps) {
      if (decisions.get(fp) !== 'rejected') {
        decisions.set(fp, 'accepted');
      }
    }
    return { fileDecisions: decisions };
  }),

  rejectAll: (fps) => set((state) => {
    const decisions = new Map(state.fileDecisions);
    for (const fp of fps) {
      decisions.set(fp, 'rejected');
    }
    return { fileDecisions: decisions };
  }),

  getAcceptedFiles: () => {
    const decisions = get().fileDecisions;
    const accepted: string[] = [];
    decisions.forEach((d, fp) => {
      if (d === 'accepted') accepted.push(fp);
    });
    return accepted;
  },

  reset: () => set({
    runId: null,
    projectId: null,
    runInfo: null,
    fileDecisions: new Map(),
    activeFilePath: null,
    diffMode: 'side-by-side',
  }),
}));
