import React, { useCallback } from 'react';
import type { SplitDirection } from '../../lib/types';

interface DividerProps {
  direction: SplitDirection;
  onResize: (ratio: number) => void;
  parentRef: React.RefObject<HTMLDivElement>;
}

export function Divider({ direction, onResize, parentRef }: DividerProps) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const parent = parentRef.current;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    const onMouseMove = (e: MouseEvent) => {
      let ratio: number;
      if (direction === 'horizontal') {
        ratio = (e.clientX - rect.left) / rect.width;
      } else {
        ratio = (e.clientY - rect.top) / rect.height;
      }
      onResize(Math.max(0.1, Math.min(0.9, ratio)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction, onResize, parentRef]);

  return (
    <div
      className={`divider divider-${direction}`}
      onMouseDown={handleMouseDown}
      style={{
        flexShrink: 0,
        background: 'var(--border)',
        cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
        width: direction === 'horizontal' ? '4px' : '100%',
        height: direction === 'horizontal' ? '100%' : '4px',
      }}
    />
  );
}
