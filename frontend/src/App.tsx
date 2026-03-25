import React, { useEffect, useCallback } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TilingContainer } from './components/layout/TilingContainer';
import { StatusBar } from './components/layout/StatusBar';
import { useLayoutStore } from './stores/layoutStore';
import { useOverlayStore } from './stores/overlayStore';
import { useProjectStore } from './stores/projectStore';
import { AddProjectModal } from './components/sidebar/AddProjectModal';
import { ProjectSwitcher } from './components/overlay/ProjectSwitcher';
import { FileSearch } from './components/overlay/FileSearch';
import './App.css';

function App() {
  const splitPane = useLayoutStore(s => s.splitPane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const addTab = useLayoutStore(s => s.addTab);
  const removeTab = useLayoutStore(s => s.removeTab);
  const cycleTab = useLayoutStore(s => s.cycleTab);
  const getFocusedLeaf = useLayoutStore(s => s.getFocusedLeaf);
  const toggleOverlay = useOverlayStore(s => s.toggle);

  const loadSavedLayouts = useProjectStore(s => s.loadSavedLayouts);
  const saveCurrentLayout = useProjectStore(s => s.saveCurrentLayout);
  const persistLayout = useProjectStore(s => s.persistLayout);
  const activeProjectId = useProjectStore(s => s.activeProjectId);

  // Load saved layouts on startup
  useEffect(() => {
    loadSavedLayouts();
  }, []);

  // Auto-save layout every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeProjectId !== null) {
        saveCurrentLayout();
        persistLayout(activeProjectId);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [activeProjectId]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      cycleTab(focusedPaneId, e.shiftKey ? -1 : 1);
      return;
    }

    // Ctrl+P (no shift) — file search
    if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      toggleOverlay('fileSearch');
      return;
    }

    if (!e.ctrlKey || !e.shiftKey) return;

    switch (e.key) {
      case 'T':
        e.preventDefault();
        addTab(focusedPaneId, { type: 'terminal', title: 'Terminal' });
        break;
      case 'V':
        e.preventDefault();
        splitPane(focusedPaneId, 'vertical', 'terminal');
        break;
      case 'H':
        e.preventDefault();
        splitPane(focusedPaneId, 'horizontal', 'terminal');
        break;
      case 'P':
        e.preventDefault();
        toggleOverlay('projectSwitcher');
        break;
      case 'O':
        e.preventDefault();
        toggleOverlay('addProject');
        break;
      case 'W': {
        e.preventDefault();
        const leaf = getFocusedLeaf();
        if (leaf) {
          removeTab(focusedPaneId, leaf.activeTabIndex);
        }
        break;
      }
    }
  }, [splitPane, addTab, removeTab, cycleTab, focusedPaneId, getFocusedLeaf, toggleOverlay]);

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TilingContainer />
        <StatusBar />
      </div>
      <AddProjectModal />
      <ProjectSwitcher />
      <FileSearch />
    </div>
  );
}

export default App;
