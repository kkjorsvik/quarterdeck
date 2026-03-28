import React, { useRef, useState } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { TerminalExited } from './TerminalExited';
import { useBackgroundTerminalStore } from '../../stores/backgroundTerminalStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  workDir?: string;
  reattachSessionId?: string;
  existingSessionId?: string;  // connect to an already-running PTY (e.g., agent)
}

export function TerminalPanel({ workDir = '/tmp', reattachSessionId, existingSessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; command: string } | null>(null);
  const [key, setKey] = useState(0);

  // Check if we should reattach from background store
  // This applies to both regular terminals (reattachSessionId) and agent terminals (existingSessionId)
  const bgStore = useBackgroundTerminalStore.getState();
  const checkSessionId = reattachSessionId || existingSessionId;
  let existingWs: WebSocket | undefined;
  let existingBuffer: Uint8Array[] | undefined;
  let bgExitInfo: { code: number; command: string } | null = null;

  if (checkSessionId) {
    const bg = bgStore.terminals.get(checkSessionId);
    if (bg) {
      if (bg.exitInfo) {
        bgExitInfo = bg.exitInfo;
      } else {
        const reattached = bgStore.reattach(checkSessionId);
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
      existingSessionId={existingSessionId}
    />
  );
}

function TerminalPanelInner({ containerRef, workDir, existingWs, existingBuffer, existingSessionId }: {
  containerRef: React.RefObject<HTMLDivElement>;
  workDir: string;
  existingWs?: WebSocket;
  existingBuffer?: Uint8Array[];
  existingSessionId?: string;
}) {
  useTerminal(containerRef, { workDir, existingWs, existingBuffer, existingSessionId });

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
