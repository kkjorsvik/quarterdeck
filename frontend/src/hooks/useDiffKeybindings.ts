import { useEffect } from 'react';
import { useOverlayStore } from '../stores/overlayStore';

interface DiffKeybindingCallbacks {
  onNextFile?: () => void;
  onPrevFile?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onCommit?: () => void;
  onClose?: () => void;
  onToggleMode?: () => void;
}

export function useDiffKeybindings(isActive: boolean, callbacks: DiffKeybindingCallbacks) {
  useEffect(() => {
    if (!isActive) return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when modifiers are held
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Only active when no overlay is open
      const overlayActive = useOverlayStore.getState().active;
      if (overlayActive !== 'none') return;

      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ']':
          e.preventDefault();
          callbacks.onNextFile?.();
          break;
        case '[':
          e.preventDefault();
          callbacks.onPrevFile?.();
          break;
        case 'a':
          e.preventDefault();
          callbacks.onAccept?.();
          break;
        case 'x':
          e.preventDefault();
          callbacks.onReject?.();
          break;
        case 'c':
          e.preventDefault();
          callbacks.onCommit?.();
          break;
        case 'q':
          e.preventDefault();
          callbacks.onClose?.();
          break;
        case 't':
          e.preventDefault();
          callbacks.onToggleMode?.();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, callbacks]);
}
