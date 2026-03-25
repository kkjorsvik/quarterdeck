import React from 'react';
import type { PanelTab } from '../../lib/types';
import { useLayoutStore } from '../../stores/layoutStore';

interface TabBarProps {
  paneId: string;
  tabs: PanelTab[];
  activeTabIndex: number;
}

export function TabBar({ paneId, tabs, activeTabIndex }: TabBarProps) {
  const setActiveTab = useLayoutStore(s => s.setActiveTab);
  const removeTab = useLayoutStore(s => s.removeTab);

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab ${index === activeTabIndex ? 'tab-active' : ''}`}
          onClick={() => setActiveTab(paneId, index)}
        >
          <span className="tab-icon">
            {tab.type === 'terminal' ? '>_' : '[]'}
          </span>
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); removeTab(paneId, index); }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
