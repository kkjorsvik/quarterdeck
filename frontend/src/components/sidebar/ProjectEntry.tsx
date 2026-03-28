import React, { useState, useRef, useCallback } from 'react';
import type { Project } from '../../lib/types';
import { getProjectColor } from '../../lib/projectColors';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAgentStore } from '../../stores/agentStore';

interface ProjectEntryProps {
  project: Project;
  isActive: boolean;
  branch?: string;
  onSwitch: (id: number) => void;
  onRemove: (id: number) => void;
  onSettings: (id: number) => void;
  onDragStart?: (e: React.DragEvent, project: Project) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, project: Project) => void;
}

export function ProjectEntry({
  project,
  isActive,
  branch,
  onSwitch,
  onRemove,
  onSettings,
  onDragStart,
  onDragOver,
  onDrop,
}: ProjectEntryProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const updateProject = useProjectStore(s => s.updateProject);
  const bgTerminals = useBackgroundTerminalStore(s => s.getByProject(project.id));
  const bgHasNewOutput = useBackgroundTerminalStore(s => s.hasNewOutput(project.id));
  const bgOutputTimestamp = useBackgroundTerminalStore(s => s.getProjectOutputTimestamp(project.id));
  const fgSessions = useTerminalStore(s => s.getSessionsByProject(project.id));
  const projectAgents = useAgentStore(s => s.getProjectAgents(project.id));

  const color = getProjectColor(project.sortOrder, project.color || null);

  // Activity dot logic
  const getActivityDot = useCallback(() => {
    if (isActive) return null;

    // Agent-based indicators (priority)
    if (projectAgents.length > 0) {
      if (projectAgents.some(a => a.status === 'error')) {
        return { color: '#f87171', bright: true };
      }
      if (projectAgents.some(a => a.status === 'needs_input')) {
        return { color: '#facc15', bright: true };
      }
      if (projectAgents.every(a => a.status === 'done')) {
        return { color: '#34d399', bright: false };
      }
      if (projectAgents.some(a => a.status === 'working' || a.status === 'starting')) {
        return { color: '#34d399', bright: false };
      }
    }

    // Fallback: Phase 3 terminal-based indicators
    if (bgTerminals.length === 0) return null;
    const allExited = bgTerminals.every(t => t.exitInfo !== null);
    if (allExited) return { color: '#6b7280', bright: false };
    if (bgHasNewOutput && bgOutputTimestamp) {
      const age = Date.now() - bgOutputTimestamp;
      if (age < 30000) return { color: '#facc15', bright: true };
      return { color: '#ca8a04', bright: false };
    }
    return null;
  }, [isActive, projectAgents, bgTerminals, bgHasNewOutput, bgOutputTimestamp]);

  // Terminal count
  const terminalCount = isActive ? fgSessions.length : bgTerminals.length;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const startRename = useCallback(() => {
    setRenameValue(project.name);
    setIsRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [project.name]);

  const confirmRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== project.name) {
      await updateProject(project.id, { name: trimmed });
    }
    setIsRenaming(false);
  }, [renameValue, project.name, project.id, updateProject]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
  }, []);

  const contextMenuItems: ContextMenuItem[] = [
    { label: 'Rename', onClick: startRename },
    { label: 'Settings', onClick: () => onSettings(project.id) },
    { label: 'Remove', onClick: () => onRemove(project.id), danger: true },
  ];

  const activityDot = getActivityDot();

  return (
    <>
      <div
        onClick={() => !isRenaming && onSwitch(project.id)}
        onContextMenu={handleContextMenu}
        draggable={!!onDragStart}
        onDragStart={onDragStart ? (e) => onDragStart(e, project) : undefined}
        onDragOver={onDragOver}
        onDrop={onDrop ? (e) => onDrop(e, project) : undefined}
        style={{
          padding: '6px 10px 6px 0',
          cursor: 'pointer',
          background: isActive ? 'var(--bg-active)' : 'transparent',
          borderLeft: `3px solid ${color}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '1px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '8px' }}>
          {/* Activity dot */}
          {activityDot && (
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: activityDot.color,
              flexShrink: 0,
              boxShadow: activityDot.bright ? `0 0 4px ${activityDot.color}` : 'none',
            }} />
          )}

          {/* Name */}
          {isRenaming ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                else if (e.key === 'Escape') cancelRename();
                e.stopPropagation();
              }}
              onBlur={confirmRename}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                flex: 1,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                padding: '1px 4px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          ) : (
            <span style={{
              flex: 1,
              fontSize: '13px',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {project.name}
            </span>
          )}
        </div>

        {/* Sub-info line */}
        <div style={{
          paddingLeft: activityDot ? '20px' : '8px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          opacity: 0.7,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {branch && <span>{branch}</span>}
          {branch && terminalCount > 0 && <span> · </span>}
          {terminalCount > 0 && <span>{terminalCount} term{terminalCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
