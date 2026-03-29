import React, { useEffect, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useOverlayStore } from '../../stores/overlayStore';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import { AddProjectModal } from './AddProjectModal';
import { ProjectEntry } from './ProjectEntry';
import { AgentSection } from './AgentSection';
import { NotificationBell } from './NotificationBell';

export function Sidebar() {
  const projects = useProjectStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const switchProject = useProjectStore(s => s.switchProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const deleteProject = useProjectStore(s => s.deleteProject);
  const projectBranches = useProjectStore(s => s.projectBranches);
  const pollBranches = useProjectStore(s => s.pollBranches);
  const openOverlay = useOverlayStore(s => s.open);

  // Force subscription to background terminal store for reactivity
  useBackgroundTerminalStore(s => s.terminals);

  useEffect(() => {
    loadProjects();
  }, []);

  // Poll git branches on mount and every 15 seconds
  useEffect(() => {
    pollBranches();
    const interval = setInterval(pollBranches, 15000);
    return () => clearInterval(interval);
  }, [pollBranches]);

  const handleAddProject = useCallback(() => {
    openOverlay('addProject');
  }, [openOverlay]);

  const handleRemove = useCallback((id: number) => {
    const project = projects.find(p => p.id === id);
    const name = project?.name || 'this project';
    if (window.confirm(`Remove "${name}" from Quarterdeck? The files on disk will not be deleted.`)) {
      deleteProject(id);
    }
  }, [projects, deleteProject]);

  const handleSettings = useCallback((_id: number) => {
    // TODO: open project settings panel
  }, []);

  // Drag-to-reorder state and handlers
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, project: { id: number }) => {
    setDraggedId(project.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, target: { id: number }) => {
    e.preventDefault();
    if (draggedId === null || draggedId === target.id) return;

    const projectsCopy = [...projects];
    const dragIdx = projectsCopy.findIndex(p => p.id === draggedId);
    const dropIdx = projectsCopy.findIndex(p => p.id === target.id);
    const [dragged] = projectsCopy.splice(dragIdx, 1);
    projectsCopy.splice(dropIdx, 0, dragged);

    for (let i = 0; i < projectsCopy.length; i++) {
      if (projectsCopy[i].sortOrder !== i) {
        await updateProject(projectsCopy[i].id, { sortOrder: i });
      }
    }

    setDraggedId(null);
    await loadProjects();
  }, [draggedId, projects, updateProject, loadProjects]);

  return (
    <div style={{
      width: '250px',
      minWidth: '200px',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Project header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Projects
        </span>
        <button
          onClick={handleAddProject}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: '12px',
            borderRadius: '3px',
          }}
        >
          + Add
        </button>
      </div>

      {/* Project list */}
      {projects.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {projects.map(project => (
            <ProjectEntry
              key={project.id}
              project={project}
              isActive={project.id === activeProjectId}
              branch={projectBranches.get(project.id)}
              onSwitch={switchProject}
              onRemove={handleRemove}
              onSettings={handleSettings}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Agent section */}
      <AgentSection />

      {/* Notification bell */}
      <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0, marginTop: 'auto' }}>
        <NotificationBell />
      </div>

      <AddProjectModal />
    </div>
  );
}
