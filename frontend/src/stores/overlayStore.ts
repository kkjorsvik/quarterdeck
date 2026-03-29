import { create } from 'zustand';

type OverlayType = 'none' | 'addProject' | 'projectSwitcher' | 'spawnAgent' | 'commitReview';

interface OverlayState {
  active: OverlayType;
  open: (type: OverlayType) => void;
  close: () => void;
  toggle: (type: OverlayType) => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  active: 'none',
  open: (type) => set({ active: type }),
  close: () => set({ active: 'none' }),
  toggle: (type) => {
    const current = get().active;
    set({ active: current === type ? 'none' : type });
  },
}));
