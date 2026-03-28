import React, { useRef } from 'react';
import type { LayoutNode } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';
import { Pane } from './Pane';
import { Divider } from './Divider';

function RenderNode({ node }: { node: LayoutNode }) {
  const resizeSplit = useLayoutStore(s => s.resizeSplit);
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'leaf') {
    return <Pane key={node.id} node={node} />;
  }

  const isHorizontal = node.direction === 'horizontal';
  const firstSize = `${node.ratio * 100}%`;
  const secondSize = `${(1 - node.ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: `0 0 calc(${firstSize} - 2px)`, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <RenderNode key={node.children[0].id} node={node.children[0]} />
      </div>
      <Divider
        direction={node.direction}
        parentRef={containerRef as React.RefObject<HTMLDivElement>}
        onResize={(ratio) => resizeSplit(node.id, ratio)}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <RenderNode key={node.children[1].id} node={node.children[1]} />
      </div>
    </div>
  );
}

export function TilingContainer() {
  const root = useLayoutStore(s => s.root);
  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <RenderNode node={root} />
    </div>
  );
}
