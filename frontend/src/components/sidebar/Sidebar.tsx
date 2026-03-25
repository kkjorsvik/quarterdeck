import React, { useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { FileTree } from '../filetree/FileTree';

export function Sidebar() {
  const projects = useProjectStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const addProject = useProjectStore(s => s.addProject);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const activeProject = useProjectStore(s => s.getActiveProject());

  useEffect(() => {
    loadProjects();
  }, []);

  const handleAddProject = async () => {
    try {
      // OpenDirectoryDialog is not available in the generated Wails runtime;
      // fall back to a prompt so the user can type an absolute path.
      const path = window.prompt('Enter project directory path:');
      if (path && path.trim()) {
        const trimmed = path.trim();
        const name = trimmed.split('/').pop() || trimmed;
        await addProject(name, trimmed);
      }
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

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
            <div
              key={project.id}
              onClick={() => setActiveProject(project.id)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '13px',
                color: project.id === activeProjectId ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: project.id === activeProjectId ? 'var(--bg-active)' : 'transparent',
              }}
            >
              {project.name}
            </div>
          ))}
        </div>
      )}

      {/* File tree */}
      {activeProject ? (
        <FileTree rootPath={activeProject.path} />
      ) : (
        <div style={{ padding: '16px 12px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
          {projects.length === 0 ? 'Add a project to get started' : 'Select a project'}
        </div>
      )}
    </div>
  );
}
