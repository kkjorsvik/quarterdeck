import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

interface UseTerminalOptions {
  workDir: string;
  onReady?: () => void;
}

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>, options: UseTerminalOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#44475a',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Try WebGL renderer, fall back to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // Canvas renderer is the default fallback
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit terminal to container
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // ResizeObserver for auto-fit
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    // Connect to backend
    const connect = async () => {
      try {
        const port = await window.go.main.App.GetWSPort();
        const cols = term.cols;
        const rows = term.rows;
        const id = await window.go.main.App.CreateTerminal(options.workDir || '/tmp', cols, rows);
        sessionIdRef.current = id;

        const socket = new WebSocket(`ws://localhost:${port}/ws/pty/${id}`);
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.onopen = () => {
          term.focus();
          options.onReady?.();
        };

        socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data));
          } else if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'exited') {
                term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
              }
            } catch {
              // ignore non-JSON text
            }
          }
        };

        socket.onclose = () => {
          term.write('\r\n\x1b[90m[Session ended]\x1b[0m\r\n');
        };

        // Terminal input -> WebSocket
        term.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) {
            const encoder = new TextEncoder();
            socket.send(encoder.encode(data));
          }
        });

        // Terminal resize -> WebSocket control message
        term.onResize(({ cols, rows }) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });
      } catch (err) {
        term.write(`\r\n\x1b[31mFailed to connect: ${err}\x1b[0m\r\n`);
      }
    };

    connect();

    // Cleanup
    return () => {
      observer.disconnect();
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (sessionIdRef.current) {
        window.go.main.App.CloseTerminal(sessionIdRef.current).catch(() => {});
      }
      term.dispose();
    };
  }, []); // Mount once

  return {
    terminal: terminalRef,
    fit: useCallback(() => fitAddonRef.current?.fit(), []),
  };
}
