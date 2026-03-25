import React, { useEffect, useCallback } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TilingContainer } from './components/layout/TilingContainer';
import { useLayoutStore } from './stores/layoutStore';
import './App.css';

function App() {
  const splitPane = useLayoutStore(s => s.splitPane);
  const closePane = useLayoutStore(s => s.closePane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!e.ctrlKey || !e.shiftKey) return;

    switch (e.key) {
      case 'T':
        // New terminal (split current pane horizontally)
        e.preventDefault();
        splitPane(focusedPaneId, 'horizontal', 'terminal');
        break;
      case 'V':
        // Split vertical
        e.preventDefault();
        splitPane(focusedPaneId, 'vertical', 'terminal');
        break;
      case 'H':
        // Split horizontal
        e.preventDefault();
        splitPane(focusedPaneId, 'horizontal', 'terminal');
        break;
      case 'W':
        // Close focused pane
        e.preventDefault();
        closePane(focusedPaneId);
        break;
    }
  }, [splitPane, closePane, focusedPaneId]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div style={{
      display: 'flex',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
    }}>
      <Sidebar />
      <TilingContainer />
    </div>
  );
}

export default App;
