import React from 'react';
import { useOverlayStore } from '../../stores/overlayStore';

export function OverlayContainer({ children }: { children: React.ReactNode }) {
  const close = useOverlayStore(s => s.close);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '80px', background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {children}
    </div>
  );
}
