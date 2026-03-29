import React, { useEffect, useCallback, useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TilingContainer } from './components/layout/TilingContainer';
import { StatusBar } from './components/layout/StatusBar';
import { useLayoutStore } from './stores/layoutStore';
import { useOverlayStore } from './stores/overlayStore';
import { useProjectStore } from './stores/projectStore';
import { AddProjectModal } from './components/sidebar/AddProjectModal';
import { ProjectSwitcher } from './components/overlay/ProjectSwitcher';
import { SpawnAgentModal } from './components/sidebar/SpawnAgentModal';
import { CommitModal } from './components/review/CommitModal';
import { useAgentEvents } from './hooks/useAgentEvents';
import './App.css';

function App() {
  const splitPane = useLayoutStore(s => s.splitPane);
  const focusedPaneId = useLayoutStore(s => s.focusedPaneId);
  const addTab = useLayoutStore(s => s.addTab);
  const removeTab = useLayoutStore(s => s.removeTab);
  const cycleTab = useLayoutStore(s => s.cycleTab);
  const getFocusedLeaf = useLayoutStore(s => s.getFocusedLeaf);
  const toggleOverlay = useOverlayStore(s => s.toggle);

  const [wsPort, setWsPort] = useState<number | null>(null);
  useAgentEvents(wsPort);

  const loadSavedLayouts = useProjectStore(s => s.loadSavedLayouts);
  const saveCurrentLayout = useProjectStore(s => s.saveCurrentLayout);
  const persistLayout = useProjectStore(s => s.persistLayout);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const pollGitStatus = useProjectStore(s => s.pollGitStatus);
  const refreshGitStatus = useProjectStore(s => s.refreshGitStatus);

  // Load saved layouts on startup
  useEffect(() => {
    loadSavedLayouts();
  }, []);

  // Load WS port for agent event stream
  useEffect(() => {
    (window as any).go.main.App.GetWSPort().then((port: number) => setWsPort(port)).catch(() => {});
  }, []);

  // Poll git status every 3 seconds for the active project
  useEffect(() => {
    if (!activeProjectId) return;
    refreshGitStatus();
    const interval = setInterval(() => pollGitStatus(), 3000);
    return () => clearInterval(interval);
  }, [activeProjectId, refreshGitStatus, pollGitStatus]);

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
      case 'A':
        e.preventDefault();
        toggleOverlay('spawnAgent');
        break;
      case 'D': {
        e.preventDefault();
        if (activeProjectId === null) break;
        // Smart: if exactly 1 done run, open review directly; else open history
        window.go.main.App.ListProjectRuns(activeProjectId).then((runs: any[]) => {
          const doneRuns = (runs || []).filter((r: any) => r.status === 'done');
          if (doneRuns.length === 1) {
            const run = doneRuns[0];
            const title = 'Review: ' + (run.taskDescription || 'Run').slice(0, 20);
            addTab(focusedPaneId, { type: 'review', title, runId: run.id, projectId: activeProjectId });
          } else {
            addTab(focusedPaneId, { type: 'runHistory', title: 'Run History', projectId: activeProjectId });
          }
        }).catch(() => {
          addTab(focusedPaneId, { type: 'runHistory', title: 'Run History', projectId: activeProjectId });
        });
        break;
      }
      case 'G': {
        e.preventDefault();
        if (activeProjectId === null) break;
        addTab(focusedPaneId, { type: 'workingTree', title: 'Working Tree', projectId: activeProjectId });
        break;
      }
      case 'B':
        e.preventDefault();
        if (activeProjectId) addTab(focusedPaneId, { type: 'branch', title: 'Branches', projectId: activeProjectId });
        break;
      case 'L':
        e.preventDefault();
        if (activeProjectId) addTab(focusedPaneId, { type: 'gitLog', title: 'Git Log', projectId: activeProjectId });
        break;
      case 'F':
        e.preventDefault();
        addTab(focusedPaneId, { type: 'dashboard', title: 'Agent Dashboard' });
        break;
      case 'E':
        e.preventDefault();
        addTab(focusedPaneId, { type: 'activity', title: 'Activity' });
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
      <SpawnAgentModal />
      <CommitModal />
    </div>
  );
}

export default App;
