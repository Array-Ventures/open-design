import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs } from './boardui/tabs';

export function FileCategoryTabs({ tabs, selected, onChange, label, children }: {
  tabs: Array<{ id: string; label: string; count: number }>;
  selected: string | null; onChange: (id: string) => void; label: string; children: ReactNode;
}) {
  if (!selected) return <>{children}</>;
  return <Tabs selectedKey={selected} onSelectionChange={key => onChange(String(key))} className="df-category-tabs">
    <div className="df-category-strip">
      <TabList aria-label={label} data-testid="design-files-tabs">
        {tabs.map(tab => <Tab key={tab.id} id={tab.id} count={tab.count} data-testid={`design-files-tab-${tab.id}`}>{tab.label}</Tab>)}
      </TabList>
    </div>
    <TabPanel id={selected} className="df-category-content">{children}</TabPanel>
  </Tabs>;
}
