import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SegmentedTabs, SegmentedTabPanel, type SegmentedTabItem } from './SegmentedTabs';

const meta: Meta<typeof SegmentedTabs> = {
  title: 'UI Primitives/SegmentedTabs',
  component: SegmentedTabs,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SegmentedTabs>;

function InlinePanelsDemo() {
  const [tab, setTab] = useState<'timeline' | 'broadcasts'>('timeline');
  const tabs: SegmentedTabItem<'timeline' | 'broadcasts'>[] = [
    {
      value: 'timeline',
      label: 'Content Snapshots',
      content: (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          Snapshot versions table panel content.
        </div>
      ),
    },
    {
      value: 'broadcasts',
      label: 'Broadcast Delivery Logs',
      content: (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          Broadcast delivery logs panel content.
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 max-w-2xl">
      <SegmentedTabs
        aria-label="History view switcher"
        value={tab}
        onChange={setTab}
        tabs={tabs}
      />
    </div>
  );
}

export const WithInlinePanels: Story = {
  render: () => <InlinePanelsDemo />,
};

function DetachedPanelDemo() {
  const [status, setStatus] = useState<'all' | 'redeemed' | 'unused'>('all');
  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Invitation Codes</h3>
        <SegmentedTabs
          idPrefix="story-redemption"
          panelId="story-redemption-panel"
          aria-label="Filter invitation codes by status"
          size="sm"
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'all', label: 'All (12)' },
            { value: 'redeemed', label: 'Redeemed (5)' },
            { value: 'unused', label: 'Unused (7)' },
          ]}
        />
      </div>
      <SegmentedTabPanel
        id="story-redemption-panel"
        tabId={`story-redemption-tab-${status}`}
        className="p-4 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      >
        <p className="text-sm">Showing filtered records for status: <strong>{status}</strong></p>
      </SegmentedTabPanel>
    </div>
  );
}

export const CompactWithDetachedPanel: Story = {
  render: () => <DetachedPanelDemo />,
};

function PillCountBadgesDemo() {
  const [category, setCategory] = useState<'curated' | 'guest'>('curated');
  return (
    <div className="p-4 max-w-2xl">
      <SegmentedTabs
        variant="pills"
        aria-label="Photo gallery views"
        value={category}
        onChange={setCategory}
        tabs={[
          { value: 'curated', label: 'Curated Album', count: 16 },
          { value: 'guest', label: 'Guest Uploads', count: 4 },
        ]}
      />
    </div>
  );
}

export const PillsWithCountBadges: Story = {
  render: () => <PillCountBadgesDemo />,
};
