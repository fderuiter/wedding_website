import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import InteractiveTimeline from '../InteractiveTimeline';
import type { ContentNodeDTO } from '@/features/content/schemas';

describe('InteractiveTimeline Component', () => {
  const sampleEvents: ContentNodeDTO[] = [
    {
      id: 'event-1',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Rehearsal Dinner',
        startTime: '2026-06-19T18:00:00.000Z',
        endTime: '2026-06-19T21:00:00.000Z',
        categoryTags: ['Rehearsal'],
        locationName: 'The Oak Room',
        attireRules: 'Smart Casual',
        description: 'Welcome dinner for family and wedding party.',
      },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'event-2',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Wedding Ceremony',
        startTime: '2026-06-20T15:00:00.000Z',
        endTime: '2026-06-20T16:00:00.000Z',
        categoryTags: ['Ceremony'],
        locationName: 'St. Mary Church',
        attireRules: 'Formal Black Tie Optional',
        description: 'Exchange of vows.',
      },
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    },
    {
      id: 'event-3',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Evening Reception',
        startTime: '2026-06-20T18:00:00.000Z',
        endTime: '2026-06-20T23:00:00.000Z',
        categoryTags: ['Reception'],
        locationName: 'Grand Crystal Ballroom',
        attireRules: 'Cocktail Attire',
        description: 'Dinner, drinks, and dancing.',
      },
      createdAt: new Date('2026-01-03'),
      updatedAt: new Date('2026-01-03'),
    },
  ];

  it('renders interactive timeline header and filter tabs', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" title="Wedding Weekend Schedule" />);

    expect(screen.getByText('Wedding Weekend Schedule')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rehearsal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ceremony' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reception' })).toBeInTheDocument();
  });

  it('renders event cards in ascending chronological order', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Rehearsal Dinner', 'Wedding Ceremony', 'Evening Reception']);
  });

  it('filters events when category filter button is clicked', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    // Click Ceremony tab
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    fireEvent.click(ceremonyTab);

    expect(screen.getByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.queryByText('Rehearsal Dinner')).not.toBeInTheDocument();
    expect(screen.queryByText('Evening Reception')).not.toBeInTheDocument();

    // Click All tab
    const allTab = screen.getByRole('tab', { name: 'All' });
    fireEvent.click(allTab);

    expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    expect(screen.getByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Evening Reception')).toBeInTheDocument();
  });

  it('displays location, attire rules, and per-event calendar export button', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    expect(screen.getByText('The Oak Room')).toBeInTheDocument();
    expect(screen.getByText('Smart Casual')).toBeInTheDocument();

    const calendarButtons = screen.getAllByRole('button', { name: /add to calendar/i });
    expect(calendarButtons.length).toBe(3);
  });

  it('returns null when no structured events exist', () => {
    const { container } = render(<InteractiveTimeline events={[]} timezone="UTC" />);
    expect(container.firstChild).toBeNull();
  });

  it('assigns roving tabIndex to category tabs', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const allTab = screen.getByRole('tab', { name: 'All' });
    const rehearsalTab = screen.getByRole('tab', { name: 'Rehearsal' });
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    const receptionTab = screen.getByRole('tab', { name: 'Reception' });

    expect(allTab).toHaveAttribute('tabindex', '0');
    expect(rehearsalTab).toHaveAttribute('tabindex', '-1');
    expect(ceremonyTab).toHaveAttribute('tabindex', '-1');
    expect(receptionTab).toHaveAttribute('tabindex', '-1');

    fireEvent.click(ceremonyTab);

    expect(allTab).toHaveAttribute('tabindex', '-1');
    expect(ceremonyTab).toHaveAttribute('tabindex', '0');
  });

  it('handles arrow, Home, and End key navigation across category tabs', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const allTab = screen.getByRole('tab', { name: 'All' });
    const rehearsalTab = screen.getByRole('tab', { name: 'Rehearsal' });
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    const receptionTab = screen.getByRole('tab', { name: 'Reception' });

    // ArrowRight: All -> Rehearsal
    fireEvent.keyDown(allTab, { key: 'ArrowRight' });
    expect(rehearsalTab).toHaveFocus();
    expect(rehearsalTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    expect(screen.queryByText('Wedding Ceremony')).not.toBeInTheDocument();

    // ArrowDown: Rehearsal -> Ceremony
    fireEvent.keyDown(rehearsalTab, { key: 'ArrowDown' });
    expect(ceremonyTab).toHaveFocus();
    expect(ceremonyTab).toHaveAttribute('tabindex', '0');

    // End: Ceremony -> Reception
    fireEvent.keyDown(ceremonyTab, { key: 'End' });
    expect(receptionTab).toHaveFocus();
    expect(receptionTab).toHaveAttribute('tabindex', '0');

    // ArrowRight (wrapping): Reception -> All
    fireEvent.keyDown(receptionTab, { key: 'ArrowRight' });
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('tabindex', '0');

    // ArrowLeft (wrapping): All -> Reception
    fireEvent.keyDown(allTab, { key: 'ArrowLeft' });
    expect(receptionTab).toHaveFocus();

    // Home: Reception -> All
    fireEvent.keyDown(receptionTab, { key: 'Home' });
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('tabindex', '0');
  });

  it('maintains ARIA controls and labelledby linkages between tab buttons and tabpanel', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const allTab = screen.getByRole('tab', { name: 'All' });
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });

    expect(allTab).toHaveAttribute('id', 'timeline-tab-all');
    expect(allTab).toHaveAttribute('aria-controls', 'timeline-events-panel');
    expect(ceremonyTab).toHaveAttribute('id', 'timeline-tab-ceremony');
    expect(ceremonyTab).toHaveAttribute('aria-controls', 'timeline-events-panel');

    const tabPanel = screen.getByRole('tabpanel');
    expect(tabPanel).toHaveAttribute('id', 'timeline-events-panel');
    expect(tabPanel).toHaveAttribute('aria-labelledby', 'timeline-tab-all');
    expect(tabPanel).toHaveAttribute('tabindex', '0');

    fireEvent.click(ceremonyTab);
    expect(tabPanel).toHaveAttribute('aria-labelledby', 'timeline-tab-ceremony');
  });

  it('announces live status updates for filter changes', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveTextContent('Showing 3 events for All categories');

    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    fireEvent.click(ceremonyTab);

    expect(statusRegion).toHaveTextContent('Showing 1 event for Ceremony');
  });

  it('omits filter tabs and status region when only one category exists', () => {
    const singleCategoryEvents: ContentNodeDTO[] = [sampleEvents[0]];
    render(<InteractiveTimeline events={singleCategoryEvents} timezone="UTC" />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('applies custom category accent colors when provided in event categoryColors or structured tags', () => {
    const eventsWithCategoryColors: ContentNodeDTO[] = [
      {
        id: 'event-accent-1',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Ceremony Event',
          startTime: '2026-06-20T14:00:00.000Z',
          categoryTags: ['Ceremony'],
          categoryColors: {
            Ceremony: { bg: 'rgb(254, 243, 199)', text: 'rgb(146, 64, 14)' },
          },
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'event-accent-2',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Reception Party',
          startTime: '2026-06-20T18:00:00.000Z',
          categoryTags: [
            { name: 'Reception', bg: 'rgb(254, 226, 226)', text: 'rgb(153, 27, 27)' },
          ],
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ];

    render(<InteractiveTimeline events={eventsWithCategoryColors} timezone="UTC" />);

    // Click Ceremony tab to activate it
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    fireEvent.click(ceremonyTab);

    // Active Ceremony tab should have custom background
    expect(ceremonyTab).toHaveStyle({ backgroundColor: 'rgb(254, 243, 199)', color: 'rgb(146, 64, 14)' });

    // Category tag badge for Ceremony should also have custom styles
    const ceremonyBadge = screen.getByText('Ceremony', { selector: 'span' });
    expect(ceremonyBadge).toHaveStyle({ backgroundColor: 'rgb(254, 243, 199)', color: 'rgb(146, 64, 14)' });

    // Click Reception tab
    const receptionTab = screen.getByRole('tab', { name: 'Reception' });
    fireEvent.click(receptionTab);

    expect(receptionTab).toHaveStyle({ backgroundColor: 'rgb(254, 226, 226)', color: 'rgb(153, 27, 27)' });
    const receptionBadge = screen.getByText('Reception', { selector: 'span' });
    expect(receptionBadge).toHaveStyle({ backgroundColor: 'rgb(254, 226, 226)', color: 'rgb(153, 27, 27)' });
  });

  it('renders EmptyState and hides timeline border when active category has no matching events', () => {
    const { rerender, container } = render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    // Select Rehearsal category
    const rehearsalTab = screen.getByRole('tab', { name: 'Rehearsal' });
    fireEvent.click(rehearsalTab);
    expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();

    // Rerender with events omitting Rehearsal category
    const eventsWithoutRehearsal = [sampleEvents[1], sampleEvents[2]];
    rerender(<InteractiveTimeline events={eventsWithoutRehearsal} timezone="UTC" />);

    // EmptyState should be displayed
    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('No schedule events found for "Rehearsal".')).toBeInTheDocument();

    // Clear filter button should be rendered
    const clearButton = screen.getByRole('button', { name: 'Clear filter' });
    expect(clearButton).toBeInTheDocument();

    // Vertical timeline border container should not be rendered
    const timelineBorderContainer = container.querySelector('.border-l-2');
    expect(timelineBorderContainer).toBeNull();

    // Category tabs should remain visible
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ceremony' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reception' })).toBeInTheDocument();

    // Click "Clear filter" to reset category filter to "All"
    fireEvent.click(clearButton);

    // Schedule cards should reappear and EmptyState should disappear
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    expect(screen.getByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Evening Reception')).toBeInTheDocument();
  });

  describe('RSVP Batch Coordination and State Management', () => {
    const sampleEventsWithRsvp: ContentNodeDTO[] = [
      {
        id: 'event-1',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Rehearsal Dinner',
          startTime: '2026-06-19T18:00:00.000Z',
          endTime: '2026-06-19T21:00:00.000Z',
          categoryTags: ['Rehearsal'],
          userRsvp: {
            status: 'pending',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'event-2',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Wedding Ceremony',
          startTime: '2026-06-20T15:00:00.000Z',
          endTime: '2026-06-20T16:00:00.000Z',
          categoryTags: ['Ceremony'],
          userRsvp: {
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: '',
          },
        },
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      },
    ];

    beforeEach(() => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: false,
            json: async () => ({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    it('highlights modified cards, shows batch bar, and submits all dirty events on Save All modified events', async () => {
      let resolveFetch: (_value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/rsvp') {
          return fetchPromise;
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      // Initially, batch bar should not be visible
      expect(screen.queryByTestId('rsvp-batch-bar')).not.toBeInTheDocument();

      // Edit Event 1 (Rehearsal Dinner) to Attending
      const event1Card = screen.getByTestId('rsvp-card-event-1');
      const attendingBtn1 = event1Card.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      fireEvent.click(attendingBtn1);

      // Now Event 1 should show "Unsaved changes"
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      // Batch bar should appear with Save All modified events button
      expect(screen.getByTestId('rsvp-batch-bar')).toBeInTheDocument();
      expect(screen.getByText(/1 event has unsaved changes/i)).toBeInTheDocument();

      // Edit Event 2 plus-one count
      const event2Card = screen.getByTestId('rsvp-card-event-2');
      const plusOneInput2 = event2Card.querySelector('input[type="number"]') as HTMLInputElement;
      fireEvent.change(plusOneInput2, { target: { value: '3' } });

      expect(screen.getByText(/2 events have unsaved changes/i)).toBeInTheDocument();

      // Click "Save All modified events"
      const saveAllBtn = screen.getByRole('button', { name: /save all modified events/i });
      fireEvent.click(saveAllBtn);

      // All input controls should be disabled while submission is in flight (Criterion 4)
      expect(attendingBtn1).toBeDisabled();
      expect(plusOneInput2).toBeDisabled();
      expect(saveAllBtn).toBeDisabled();

      // Resolve the fetch call
      resolveFetch!({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            { id: 'r1', subEventId: 'event-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
            { id: 'r2', subEventId: 'event-2', status: 'attending', plusOneCount: 3, dietaryNotes: '' },
          ],
        }),
      });

      // Wait for async update
      const liveStatus = await screen.findByTestId('rsvp-live-status');
      expect(liveStatus).toHaveTextContent('Successfully saved RSVPs for 2 events.');

      // Unsaved changes badges should now be gone
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
      expect(screen.getByText(/Saved 2 RSVP updates/i)).toBeInTheDocument();
    });

    it('preserves unsaved edits across category filter transitions', () => {
      render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      // Switch to Rehearsal tab
      const rehearsalTab = screen.getByRole('tab', { name: 'Rehearsal' });
      fireEvent.click(rehearsalTab);

      // Edit Rehearsal Dinner dietary notes
      const notesInput = screen.getByPlaceholderText('e.g. Vegetarian, Nut allergy') as HTMLInputElement;
      fireEvent.change(notesInput, { target: { value: 'Strictly Kosher' } });

      expect(notesInput.value).toBe('Strictly Kosher');
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      // Switch to Ceremony tab (Rehearsal Dinner unmounts from view)
      const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
      fireEvent.click(ceremonyTab);
      expect(screen.queryByText('Rehearsal Dinner')).not.toBeInTheDocument();

      // Switch back to All tab
      const allTab = screen.getByRole('tab', { name: 'All' });
      fireEvent.click(allTab);

      // Rehearsal Dinner edits must be preserved
      const event1Card = screen.getByTestId('rsvp-card-event-1');
      const restoredInput = event1Card.querySelector('input[type="text"]') as HTMLInputElement;
      expect(restoredInput.value).toBe('Strictly Kosher');
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('flags failed cards, preserves user edits, and suggests retry on network error', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/rsvp') {
          return Promise.resolve({
            ok: false,
            json: async () => ({
              success: false,
              error: 'Database connection failed. Please retry.',
            }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      // Modify Event 1
      const event1Card = screen.getByTestId('rsvp-card-event-1');
      const attendingBtn = event1Card.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      fireEvent.click(attendingBtn);

      const saveAllBtn = screen.getByRole('button', { name: /save all modified events/i });
      fireEvent.click(saveAllBtn);

      // Expect error on card and batch bar
      const retryBatchBtn = await screen.findByRole('button', { name: /retry batch/i });
      expect(retryBatchBtn).toBeInTheDocument();
      expect(screen.getAllByText(/Database connection failed/i).length).toBeGreaterThan(0);

      // Pending user edit is preserved
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('clears stale confirmation message when user modifies input', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/rsvp') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: [{ id: 'r1', subEventId: 'event-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' }],
            }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      // Save Event 1 individually
      const event1Card = screen.getByTestId('rsvp-card-event-1');
      const attendingBtn = event1Card.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      fireEvent.click(attendingBtn);

      const saveBtn = within(event1Card).getByRole('button', { name: 'Save RSVP' });
      fireEvent.click(saveBtn);

      // Confirmation banner appears
      const successBanner = await screen.findByText('RSVP submitted successfully!');
      expect(successBanner).toBeInTheDocument();

      // Modify dietary notes: stale confirmation banner must clear
      const notesInput = event1Card.querySelector('input[type="text"]') as HTMLInputElement;
      fireEvent.change(notesInput, { target: { value: 'Gluten sensitivity' } });

      expect(screen.queryByText('RSVP submitted successfully!')).not.toBeInTheDocument();
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });
});
