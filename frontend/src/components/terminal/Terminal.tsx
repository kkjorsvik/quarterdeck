import React, { useRef, useState } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { TerminalExited } from './TerminalExited';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  workDir?: string;
  reattachSessionId?: string;
}

export function TerminalPanel({ workDir = '/tmp', reattachSessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; command: string } | null>(null);
  const [key, setKey] = useState(0);

  // Check if we should reattach
  const bgStore = useBackgroundTerminalStore.getState();
  let existingWs: WebSocket | undefined;
  let existingBuffer: Uint8Array[] | undefined;
  let bgExitInfo: { code: number; command: string } | null = null;

  if (reattachSessionId) {
    const bg = bgStore.terminals.get(reattachSessionId);
    if (bg) {
      if (bg.exitInfo) {
        bgExitInfo = bg.exitInfo;
      } else {
        const reattached = bgStore.reattach(reattachSessionId);
        if (reattached) {
          existingWs = reattached.ws;
          existingBuffer = reattached.buffer;
        }
      }
    }
  }

  if (bgExitInfo || exitInfo) {
    const info = bgExitInfo || exitInfo!;
    return (
      <TerminalExited
        exitCode={info.code}
        command={info.command}
        onRestart={() => {
          setExitInfo(null);
          setKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <TerminalPanelInner
      key={key}
      containerRef={containerRef}
      workDir={workDir}
      existingWs={existingWs}
      existingBuffer={existingBuffer}
    />
  );
}

function TerminalPanelInner({ containerRef, workDir, existingWs, existingBuffer }: {
  containerRef: React.RefObject<HTMLDivElement>;
  workDir: string;
  existingWs?: WebSocket;
  existingBuffer?: Uint8Array[];
}) {
  useTerminal(containerRef, { workDir, existingWs, existingBuffer });

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
