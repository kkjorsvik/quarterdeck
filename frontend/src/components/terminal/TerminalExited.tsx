import React from 'react';

interface TerminalExitedProps {
  exitCode: number;
  command: string;
  onRestart: () => void;
}

export function TerminalExited({ exitCode, command, onRestart }: TerminalExitedProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '12px',
      color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{ fontSize: '13px' }}>
        [session ended — exit {exitCode}] {command}
      </div>
      <button
        onClick={onRestart}
        style={{
          background: 'var(--bg-active)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: '4px',
          padding: '6px 16px', fontSize: '12px', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Restart
      </button>
    </div>
  );
}
