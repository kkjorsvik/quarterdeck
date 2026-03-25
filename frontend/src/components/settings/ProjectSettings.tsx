import React, { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';

interface ProjectSettingsProps {
  projectId: number;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-primary, #111)',
  border: '1px solid var(--border, #333)',
  borderRadius: '4px',
  padding: '6px 8px',
  color: 'var(--text-primary, #ccc)',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: 'var(--text-secondary, #888)',
  marginBottom: '4px',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: '12px',
};

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const projects = useProjectStore(s => s.projects);
  const updateProject = useProjectStore(s => s.updateProject);
  const project = projects.find(p => p.id === projectId);

  const [name, setName] = useState('');
  const [gitDefaultBranch, setGitDefaultBranch] = useState('');
  const [devServerUrl, setDevServerUrl] = useState('');
  const [devServerCommand, setDevServerCommand] = useState('');
  const [defaultAgentType, setDefaultAgentType] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setGitDefaultBranch(project.gitDefaultBranch || '');
      setDevServerUrl(project.devServerUrl || '');
      setDevServerCommand(project.devServerCommand || '');
      setDefaultAgentType(project.defaultAgentType || '');
      setNotes(project.notes || '');
      setSaved(false);
    }
  }, [project?.id]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    await updateProject(projectId, {
      name: name.trim() || project.name,
      gitDefaultBranch,
      devServerUrl,
      devServerCommand,
      defaultAgentType,
      notes,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [projectId, project, name, gitDefaultBranch, devServerUrl, devServerCommand, defaultAgentType, notes, updateProject]);

  if (!project) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-secondary, #888)' }}>
        Project not found
      </div>
    );
  }

  return (
    <div style={{
      padding: '20px',
      maxWidth: '560px',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <h3 style={{
        margin: '0 0 20px',
        color: 'var(--text-primary, #ccc)',
        fontSize: '16px',
        fontWeight: 600,
      }}>
        Project Settings
      </h3>

      <div style={fieldStyle}>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Path</label>
        <input
          type="text"
          value={project.path}
          readOnly
          style={{ ...inputStyle, opacity: 0.6, cursor: 'default' }}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Git Default Branch</label>
        <input
          type="text"
          value={gitDefaultBranch}
          onChange={e => setGitDefaultBranch(e.target.value)}
          placeholder="main"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Dev Server URL</label>
        <input
          type="text"
          value={devServerUrl}
          onChange={e => setDevServerUrl(e.target.value)}
          placeholder="http://localhost:3000"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Dev Server Command</label>
        <input
          type="text"
          value={devServerCommand}
          onChange={e => setDevServerCommand(e.target.value)}
          placeholder="npm run dev"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Default Agent Type</label>
        <input
          type="text"
          value={defaultAgentType}
          onChange={e => setDefaultAgentType(e.target.value)}
          placeholder="claude"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Project notes..."
          style={{
            ...inputStyle,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleSave}
          style={{
            background: '#3b82f6',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 20px',
            color: '#fff',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
        {saved && (
          <span style={{ fontSize: '12px', color: '#34d399' }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
