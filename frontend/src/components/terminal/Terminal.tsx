import React, { useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  workDir?: string;
}

export function TerminalPanel({ workDir = '/tmp' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useTerminal(containerRef, { workDir });

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}
