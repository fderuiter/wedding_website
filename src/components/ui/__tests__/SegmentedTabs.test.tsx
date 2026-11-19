import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  SegmentedTabs,
  SegmentedTabPanel,
  type SegmentedTabItem,
  type SegmentedTabsProps,
  type SegmentedTabPanelProps,
} from '../SegmentedTabs';

expect.extend(toHaveNoViolations);

describe('SegmentedTabs', () => {
  it('renders tablist, tabs, and inline tabpanel with ARIA attributes and zero axe violations', async () => {
    function InlineDemo(props: Partial<SegmentedTabsProps<'snapshots' | 'broadcasts'>>) {
      const [active, setActive] = useState<'snapshots' | 'broadcasts'>('snapshots');
      const tabs: SegmentedTabItem<'snapshots' | 'broadcasts'>[] = [
        {
          value: 'snapshots',
          label: 'Content Snapshots',
          content: <p>Snapshots panel body</p>,
        },
        {
          value: 'broadcasts',
          label: 'Broadcast Delivery Logs',
          content: <p>Broadcasts panel body</p>,
        },
      ];

      return (
        <SegmentedTabs
          idPrefix="history"
          aria-label="History views"
          value={active}
          onChange={setActive}
          tabs={tabs}
          {...props}
        />
      );
    }

    const { container } = render(<InlineDemo />);

    const tablist = screen.getByRole('tablist', { name: 'History views' });
    expect(tablist).toBeInTheDocument();

    const snapshotsTab = screen.getByRole('tab', { name: 'Content Snapshots' });
    const broadcastsTab = screen.getByRole('tab', { name: 'Broadcast Delivery Logs' });
    const panel = screen.getByRole('tabpanel');

    expect(snapshotsTab).toHaveAttribute('id', 'history-tab-snapshots');
    expect(snapshotsTab).toHaveAttribute('aria-selected', 'true');
    expect(snapshotsTab).toHaveAttribute('aria-controls', 'history-panel');
    expect(snapshotsTab).toHaveAttribute('tabIndex', '0');
    expect(snapshotsTab.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(snapshotsTab).toHaveClass('underline');

    expect(broadcastsTab).toHaveAttribute('id', 'history-tab-broadcasts');
    expect(broadcastsTab).toHaveAttribute('aria-selected', 'false');
    expect(broadcastsTab).toHaveAttribute('aria-controls', 'history-panel');
    expect(broadcastsTab).toHaveAttribute('tabIndex', '-1');
    expect(broadcastsTab.querySelector('svg[aria-hidden="true"]')).toBeNull();

    expect(panel).toHaveAttribute('id', 'history-panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'history-tab-snapshots');
    expect(panel).toHaveAttribute('tabIndex', '0');
    expect(screen.getByText('Snapshots panel body')).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports roving tabIndex keyboard navigation (ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End)', () => {
    function ThreeTabDemo() {
      const [active, setActive] = useState<'all' | 'redeemed' | 'unused'>('all');
      const panelProps: SegmentedTabPanelProps = {
        id: 'codes-panel',
        tabId: `codes-tab-${active}`,
      };
      return (
        <div>
          <SegmentedTabs
            idPrefix="codes"
            panelId="codes-panel"
            aria-label="Filter codes"
            size="sm"
            value={active}
            onChange={setActive}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'redeemed', label: 'Redeemed' },
              { value: 'unused', label: 'Unused' },
            ]}
          />
          <SegmentedTabPanel {...panelProps}>
            <div>Panel: {active}</div>
          </SegmentedTabPanel>
        </div>
      );
    }

    render(<ThreeTabDemo />);

    const allTab = screen.getByRole('tab', { name: 'All' });
    const redeemedTab = screen.getByRole('tab', { name: 'Redeemed' });
    const unusedTab = screen.getByRole('tab', { name: 'Unused' });

    allTab.focus();

    // ArrowRight: All -> Redeemed
    fireEvent.keyDown(allTab, { key: 'ArrowRight' });
    expect(redeemedTab).toHaveFocus();
    expect(redeemedTab).toHaveAttribute('aria-selected', 'true');
    expect(redeemedTab).toHaveAttribute('tabIndex', '0');
    expect(allTab).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByText('Panel: redeemed')).toBeInTheDocument();

    // ArrowDown: Redeemed -> Unused
    fireEvent.keyDown(redeemedTab, { key: 'ArrowDown' });
    expect(unusedTab).toHaveFocus();
    expect(unusedTab).toHaveAttribute('aria-selected', 'true');

    // ArrowRight wraps: Unused -> All
    fireEvent.keyDown(unusedTab, { key: 'ArrowRight' });
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('aria-selected', 'true');

    // ArrowLeft wraps: All -> Unused
    fireEvent.keyDown(allTab, { key: 'ArrowLeft' });
    expect(unusedTab).toHaveFocus();
    expect(unusedTab).toHaveAttribute('aria-selected', 'true');

    // ArrowUp: Unused -> Redeemed
    fireEvent.keyDown(unusedTab, { key: 'ArrowUp' });
    expect(redeemedTab).toHaveFocus();

    // Home: Redeemed -> All
    fireEvent.keyDown(redeemedTab, { key: 'Home' });
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('aria-selected', 'true');

    // End: All -> Unused
    fireEvent.keyDown(allTab, { key: 'End' });
    expect(unusedTab).toHaveFocus();
    expect(unusedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('skips disabled tabs during keyboard navigation and forwards refs', () => {
    const tablistRef = React.createRef<HTMLDivElement>();
    const panelRef = React.createRef<HTMLDivElement>();
    const onChange = jest.fn();

    render(
      <div>
        <SegmentedTabs
          ref={tablistRef}
          idPrefix="skip"
          panelId="skip-panel"
          aria-label="Tabs with disabled option"
          value="first"
          onChange={onChange}
          tabs={[
            { value: 'first', label: 'First' },
            { value: 'second', label: 'Second', disabled: true },
            { value: 'third', label: 'Third' },
          ]}
        />
        <SegmentedTabPanel ref={panelRef} id="skip-panel" tabId="skip-tab-first">
          Body
        </SegmentedTabPanel>
      </div>
    );

    expect(tablistRef.current).toBeInstanceOf(HTMLDivElement);
    expect(panelRef.current).toBeInstanceOf(HTMLDivElement);

    const firstTab = screen.getByRole('tab', { name: 'First' });
    const thirdTab = screen.getByRole('tab', { name: 'Third' });

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('third');
    expect(thirdTab).toHaveFocus();
  });
});
