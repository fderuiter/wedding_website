import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import InteractiveTimeline from '../InteractiveTimeline';
import type { ContentNodeDTO } from '@/features/content';

expect.extend(toHaveNoViolations);

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

  it('displays location, attire rules, and per-event calendar export button with unique menu IDs', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    expect(screen.getByText('The Oak Room')).toBeInTheDocument();
    expect(screen.getByText('Smart Casual')).toBeInTheDocument();

    const calendarButtons = screen.getAllByRole('button', { name: /add to calendar/i });
    expect(calendarButtons.length).toBe(3);

    const triggerIds = calendarButtons.map((btn) => btn.getAttribute('id'));
    expect(new Set(triggerIds).size).toBe(3);
    for (const btn of calendarButtons) {
      expect(btn).not.toHaveAttribute('aria-controls');
    }

    const menuIds: Array<string | null> = [];
    for (let i = 0; i < calendarButtons.length; i += 1) {
      fireEvent.click(calendarButtons[i]);
      const openMenu = screen.getByRole('menu');
      const controlledId = calendarButtons[i].getAttribute('aria-controls');
      expect(controlledId).toBeTruthy();
      expect(openMenu).toHaveAttribute('id', controlledId);
      expect(openMenu).toHaveAttribute('aria-labelledby', triggerIds[i]);
      menuIds.push(controlledId);
      fireEvent.keyDown(document, { key: 'Escape' });
    }
    expect(new Set(menuIds).size).toBe(3);
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

    it('associates RSVP form labels with unique input identifiers for accessibility', () => {
      render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      const event1Card = screen.getByTestId('rsvp-card-event-1');
      const plusOneInput1 = within(event1Card).getByLabelText(/plus-one count/i);
      const dietaryInput1 = within(event1Card).getByLabelText(/dietary requirements \/ notes/i);

      expect(plusOneInput1).toHaveAttribute('id', 'rsvp-plus-one-event-1');
      expect(dietaryInput1).toHaveAttribute('id', 'rsvp-dietary-notes-event-1');

      const event2Card = screen.getByTestId('rsvp-card-event-2');
      const plusOneInput2 = within(event2Card).getByLabelText(/plus-one count/i);
      const dietaryInput2 = within(event2Card).getByLabelText(/dietary requirements \/ notes/i);

      expect(plusOneInput2).toHaveAttribute('id', 'rsvp-plus-one-event-2');
      expect(dietaryInput2).toHaveAttribute('id', 'rsvp-dietary-notes-event-2');
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
      const attendingBtn1 = within(event1Card).getByRole('radio', { name: /attending/i }) as HTMLButtonElement;
      fireEvent.click(attendingBtn1);

      // Now Event 1 should show "Unsaved changes"
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      // Batch bar should appear with Save All modified events button
      expect(screen.getByTestId('rsvp-batch-bar')).toBeInTheDocument();
      expect(screen.getByText(/1 event has unsaved changes/i)).toBeInTheDocument();

      // Edit Event 2 plus-one count
      const event2Card = screen.getByTestId('rsvp-card-event-2');
      const plusOneInput2 = within(event2Card).getByLabelText(/plus-one count/i) as HTMLInputElement;
      fireEvent.change(plusOneInput2, { target: { value: '3' } });

      expect(screen.getByText(/2 events have unsaved changes/i)).toBeInTheDocument();

      // Click "Save All modified events"
      const saveAllBtn = screen.getByRole('button', { name: /save all modified events/i });
      fireEvent.click(saveAllBtn);

      // All input controls should be locked with busy ARIA attributes while submission is in flight
      expect(attendingBtn1).not.toBeDisabled();
      expect(attendingBtn1).toHaveAttribute('aria-disabled', 'true');
      expect(attendingBtn1).toHaveAttribute('aria-busy', 'true');
      expect(plusOneInput2).not.toBeDisabled();
      expect(plusOneInput2).toHaveAttribute('readonly');
      expect(plusOneInput2).toHaveAttribute('aria-busy', 'true');
      expect(saveAllBtn).not.toBeDisabled();
      expect(saveAllBtn).toHaveAttribute('aria-disabled', 'true');
      expect(saveAllBtn).toHaveAttribute('aria-busy', 'true');

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
      const notesInput = screen.getByLabelText(/dietary requirements \/ notes/i) as HTMLInputElement;
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
      const restoredInput = within(event1Card).getByLabelText(/dietary requirements \/ notes/i) as HTMLInputElement;
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
      const attendingBtn = within(event1Card).getByRole('radio', { name: /attending/i }) as HTMLButtonElement;
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
      const attendingBtn = within(event1Card).getByRole('radio', { name: /attending/i }) as HTMLButtonElement;
      fireEvent.click(attendingBtn);

      const saveBtn = within(event1Card).getByRole('button', { name: 'Save RSVP' });
      fireEvent.click(saveBtn);

      // Confirmation banner appears
      const successBanner = await screen.findByText('RSVP submitted successfully!');
      expect(successBanner).toBeInTheDocument();

      // Modify dietary notes: stale confirmation banner must clear
      const notesInput = within(event1Card).getByLabelText(/dietary requirements \/ notes/i) as HTMLInputElement;
      fireEvent.change(notesInput, { target: { value: 'Gluten sensitivity' } });

      expect(screen.queryByText('RSVP submitted successfully!')).not.toBeInTheDocument();
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('hides RSVP controls on read-only ContentNode fallback schedule items even when guest is signed in', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Jane Bennet',
              plusOneAllocations: 1,
              data: [
                {
                  id: 'cn-fallback-1',
                  title: 'Fallback Ceremony',
                  startTime: '2026-06-20T15:00:00.000Z',
                  category: 'Ceremony',
                  isPrivate: false,
                  isReadOnly: true,
                  userRsvp: null,
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
      });

      render(<InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events yet" />);

      expect(await screen.findByText('Fallback Ceremony')).toBeInTheDocument();
      expect(screen.queryByTestId('rsvp-card-cn-fallback-1')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save rsvp/i })).not.toBeInTheDocument();
    });

    it('disables plus-one selection when guest plusOneAllocations is 0', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Solo Guest',
              plusOneAllocations: 0,
              data: [
                {
                  id: 'se-solo',
                  title: 'Evening Reception',
                  startTime: '2026-06-20T18:00:00.000Z',
                  category: 'Reception',
                  isPrivate: false,
                  isReadOnly: false,
                  userRsvp: { status: 'attending', plusOneCount: 0, dietaryNotes: '' },
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
      });

      render(<InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events" />);

      const card = await screen.findByTestId('rsvp-card-se-solo');
      const plusOneInput = within(card).getByLabelText(/plus-one count/i) as HTMLInputElement;
      expect(plusOneInput).toBeDisabled();
      expect(plusOneInput).toHaveAttribute('max', '0');
      expect(plusOneInput.value).toBe('0');
    });

    it('allows submitting plus-ones up to positive allowance and surfaces error above that limit', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'VIP Guest',
              plusOneAllocations: 2,
              data: [
                {
                  id: 'se-vip',
                  title: 'Welcome Party',
                  startTime: '2026-06-19T18:00:00.000Z',
                  category: 'Welcome',
                  isPrivate: true,
                  isReadOnly: false,
                  userRsvp: { status: 'attending', plusOneCount: 0, dietaryNotes: '' },
                },
              ],
            }),
          });
        }
        if (url === '/api/rsvp') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: [{ id: 'r1', subEventId: 'se-vip', status: 'attending', plusOneCount: 2, dietaryNotes: '' }],
            }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      render(<InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events" />);

      const card = await screen.findByTestId('rsvp-card-se-vip');
      const plusOneInput = within(card).getByLabelText(/plus-one count/i) as HTMLInputElement;
      expect(plusOneInput).not.toBeDisabled();
      expect(plusOneInput).toHaveAttribute('max', '2');

      // Submit valid plusOneCount = 2
      fireEvent.change(plusOneInput, { target: { value: '2' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Save RSVP' }));
      expect(await screen.findByText('RSVP submitted successfully!')).toBeInTheDocument();

      // Exceed limit with plusOneCount = 3
      fireEvent.change(plusOneInput, { target: { value: '3' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Save RSVP' }));

      const errorAlert = await within(card).findByRole('alert');
      expect(errorAlert).toHaveTextContent('Plus-one count (3) exceeds your allocated limit of 2.');
      expect(plusOneInput.value).toBe('3');

      // Selecting Declined resets plus-one count to 0 and disables the input
      fireEvent.click(within(card).getByRole('radio', { name: /^declined$/i }));
      expect(plusOneInput).toBeDisabled();
      expect(plusOneInput.value).toBe('0');
    });

    it('exposes RSVP status controls as labelled radiogroups with arrow navigation, non-color indicators, and zero axe violations', async () => {
      const { container } = render(<InteractiveTimeline events={sampleEventsWithRsvp} timezone="UTC" />);

      const rehearsalRadioGroup = screen.getByRole('radiogroup', {
        name: 'Your RSVP for Rehearsal Dinner',
      });
      expect(rehearsalRadioGroup).toBeInTheDocument();

      expect(
        within(rehearsalRadioGroup).queryByRole('radio', { name: /pending/i })
      ).not.toBeInTheDocument();
      const attendingRadio = within(rehearsalRadioGroup).getByRole('radio', { name: /attending/i });
      const declinedRadio = within(rehearsalRadioGroup).getByRole('radio', { name: /declined/i });

      expect(attendingRadio).toHaveAttribute('aria-checked', 'false');
      expect(declinedRadio).toHaveAttribute('aria-checked', 'false');

      attendingRadio.focus();
      fireEvent.keyDown(attendingRadio, { key: 'Home' });
      expect(attendingRadio).toHaveFocus();
      expect(attendingRadio).toHaveAttribute('aria-checked', 'true');
      expect(attendingRadio.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();

      fireEvent.keyDown(attendingRadio, { key: 'ArrowRight' });
      expect(declinedRadio).toHaveFocus();
      expect(declinedRadio).toHaveAttribute('aria-checked', 'true');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('displays formatted deadline and venue timezone when open, and switches to read-only saved summary with calendar export when closed', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Taylor Swift',
              plusOneAllocations: 2,
              rsvpOpen: false,
              rsvpDeadlineDate: '2026-08-15',
              rsvpFormattedDeadline: 'August 15, 2026',
              timezone: 'America/Chicago',
              rsvpClosedMessage: 'RSVPs are closed. Contact hosts@example.com.',
              data: [
                {
                  id: 'se-closed-1',
                  title: 'Evening Reception',
                  startTime: '2026-09-19T18:00:00.000Z',
                  category: 'Reception',
                  isPrivate: false,
                  isReadOnly: false,
                  userRsvp: { status: 'attending', plusOneCount: 2, dietaryNotes: 'Gluten-free' },
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
      });

      const { container } = render(
        <InteractiveTimeline events={[]} timezone="America/Chicago" emptyStateMessage="No events" />
      );

      expect(await screen.findByTestId('schedule-rsvp-closed-banner')).toHaveTextContent(
        'RSVPs are closed. Contact hosts@example.com.'
      );

      const readOnlySummary = screen.getByTestId('rsvp-readonly-se-closed-1');
      expect(readOnlySummary).toHaveTextContent('Attending');
      expect(readOnlySummary).toHaveTextContent('2');
      expect(readOnlySummary).toHaveTextContent('Gluten-free');

      // Editable RSVP inputs and batch bar are hidden
      expect(screen.queryByTestId('rsvp-card-se-closed-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rsvp-batch-bar')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save RSVP/i })).not.toBeInTheDocument();

      // Calendar export remains available
      expect(screen.getByRole('button', { name: /add to calendar/i })).toBeInTheDocument();

      expect(await axe(container)).toHaveNoViolations();
    });

    it('announces HTTP 403 closing message in polite live region and locks RSVP inputs when cutoff expires mid-session', async () => {
      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Late Guest',
              plusOneAllocations: 1,
              rsvpOpen: true,
              rsvpDeadlineDate: '2026-08-15',
              rsvpFormattedDeadline: 'August 15, 2026',
              timezone: 'America/Chicago',
              data: [
                {
                  id: 'se-mid-1',
                  title: 'Ceremony',
                  startTime: '2026-09-19T16:00:00.000Z',
                  category: 'Ceremony',
                  isPrivate: false,
                  isReadOnly: false,
                  userRsvp: { status: 'attending', plusOneCount: 0, dietaryNotes: 'No peanuts' },
                },
              ],
            }),
          });
        }
        if (url === '/api/rsvp') {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: async () => ({
              success: false,
              error: 'RSVP cutoff has passed. Please contact the hosts directly.',
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      });

      render(<InteractiveTimeline events={[]} timezone="America/Chicago" emptyStateMessage="No events" />);

      expect(await screen.findByTestId('schedule-rsvp-deadline-banner')).toHaveTextContent(
        'August 15, 2026'
      );

      const card = await screen.findByTestId('rsvp-card-se-mid-1');
      fireEvent.click(within(card).getByRole('radio', { name: /^declined$/i }));
      expect(screen.getByTestId('rsvp-batch-bar')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('rsvp-save-all-button'));

      const liveRegion = await screen.findByTestId('rsvp-live-status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveTextContent(
        'RSVP cutoff has passed. Please contact the hosts directly.'
      );

      // Transitions to read-only saved baseline response ("Attending", "No peanuts") and hides batch bar
      const readOnly = await screen.findByTestId('rsvp-readonly-se-mid-1');
      expect(readOnly).toHaveTextContent('Attending');
      expect(readOnly).toHaveTextContent('No peanuts');
      expect(screen.queryByTestId('rsvp-batch-bar')).not.toBeInTheDocument();
    });

    it('renders conditional plus-one name fields, per-attendee entrée selectors, and custom RSVP prompts for attending guests with zero axe violations', async () => {
      let submittedPayload: any = null;
      (global.fetch as jest.Mock).mockImplementation(async (url, init) => {
        if (url === '/api/schedule') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Jane Doe',
              plusOneAllocations: 1,
              savedPlusOneNames: ['John Doe'],
              rsvpOpen: true,
              timezone: 'UTC',
              data: [
                {
                  id: 'se-plated',
                  title: 'Plated Reception',
                  startTime: '2026-06-20T18:00:00.000Z',
                  category: 'Reception',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [
                    {
                      id: 'm-salmon',
                      label: 'Herb-Crusted Salmon',
                      description: 'Wild rice & lemon dill',
                      dietaryTags: ['gluten-free'],
                    },
                    {
                      id: 'm-gnocchi',
                      label: 'Truffle Gnocchi',
                      description: 'Roasted wild mushrooms',
                      dietaryTags: ['vegan'],
                    },
                  ],
                  customQuestions: [
                    {
                      id: 'q-shuttle',
                      prompt: 'Will you use the hotel shuttle?',
                      type: 'choice',
                      required: true,
                      options: ['Yes, round-trip', 'No, driving'],
                    },
                    {
                      id: 'q-song',
                      prompt: 'Song request',
                      type: 'text',
                      required: false,
                      options: [],
                    },
                  ],
                  userRsvp: {
                    status: 'pending',
                    plusOneCount: 0,
                    dietaryNotes: '',
                  },
                },
              ],
            }),
          };
        }
        if (url === '/api/rsvp') {
          submittedPayload = JSON.parse(init.body);
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: [submittedPayload],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      });

      const { container } = render(
        <InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events" />
      );

      const card = await screen.findByTestId('rsvp-card-se-plated');

      expect(within(card).queryByTestId('rsvp-meals-se-plated')).not.toBeInTheDocument();
      expect(within(card).queryByTestId('rsvp-questions-se-plated')).not.toBeInTheDocument();

      fireEvent.click(within(card).getByRole('radio', { name: /^attending$/i }));
      const plusOneCountInput = within(card).getByLabelText(/plus-one count/i);
      fireEvent.change(plusOneCountInput, { target: { value: '1' } });

      const plusOneNameInput = within(card).getByLabelText('Plus-One Full Name') as HTMLInputElement;
      expect(plusOneNameInput.value).toBe('John Doe');

      const primaryMealSelect = within(card).getByLabelText(/^Entrée for Jane Doe/i) as HTMLSelectElement;
      const plusOneMealSelect = within(card).getByLabelText(/^Entrée for John Doe/i) as HTMLSelectElement;
      const shuttleSelect = within(card).getByLabelText(
        /^Will you use the hotel shuttle\?/i
      ) as HTMLSelectElement;
      const songInput = within(card).getByLabelText('Song request') as HTMLInputElement;

      fireEvent.click(within(card).getByRole('button', { name: 'Save RSVP' }));
      expect(await within(card).findByRole('alert')).toHaveTextContent(
        'Please select an entrée option for all 2 attending guests.'
      );
      expect(submittedPayload).toBeNull();

      fireEvent.change(primaryMealSelect, { target: { value: 'm-salmon' } });
      fireEvent.change(plusOneMealSelect, { target: { value: 'm-gnocchi' } });
      fireEvent.change(shuttleSelect, { target: { value: 'Yes, round-trip' } });
      fireEvent.change(songInput, { target: { value: 'September' } });

      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(within(card).getByRole('button', { name: 'Save RSVP' }));
      expect(await screen.findByText('RSVP submitted successfully!')).toBeInTheDocument();
      expect(submittedPayload).toEqual({
        subEventId: 'se-plated',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: '',
        mealSelections: ['m-salmon', 'm-gnocchi'],
        customAnswers: {
          'q-shuttle': 'Yes, round-trip',
          'q-song': 'September',
        },
        plusOneNames: ['John Doe'],
      });
    });

    it('hides editable RSVP forms and shows inline invite prompt when isGuest is false', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url === '/api/schedule') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              isGuest: false,
              guestName: null,
              plusOneAllocations: null,
              rsvpOpen: true,
              rsvpDeadlineDate: '2026-08-15',
              rsvpFormattedDeadline: 'August 15, 2026',
              timezone: 'America/Los_Angeles',
              data: [
                {
                  id: 'se-public',
                  title: 'Wedding Ceremony',
                  startTime: '2026-09-19T22:00:00.000Z',
                  endTime: '2026-09-19T23:00:00.000Z',
                  category: 'Ceremony',
                  isPrivate: false,
                  isReadOnly: false,
                  userRsvp: null,
                },
              ],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      });

      render(
        <InteractiveTimeline events={[]} timezone="America/Los_Angeles" emptyStateMessage="No events" />
      );

      const prompt = await screen.findByTestId('rsvp-invite-prompt-se-public');
      expect(prompt).toHaveTextContent(/Have a household invitation code\?/i);
      expect(within(prompt).getByRole('link', { name: /Enter Invitation Code/i })).toHaveAttribute(
        'href',
        '/guest'
      );
      expect(screen.queryByTestId('rsvp-card-se-public')).not.toBeInTheDocument();

      // Deadline banner renders friendly timezone label
      const deadlineBanner = screen.getByTestId('schedule-rsvp-deadline-banner');
      expect(deadlineBanner).toHaveTextContent('Pacific Time (PT)');

      // Calendar export menu passes ctz=America%2FLos_Angeles to Google Calendar URL
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      try {
        fireEvent.click(screen.getByRole('button', { name: /add to calendar/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /^Google$/i }));
        expect(openSpy).toHaveBeenCalledWith(
          expect.stringContaining('ctz=America%2FLos_Angeles'),
          expect.any(String),
          expect.any(String)
        );
      } finally {
        openSpy.mockRestore();
      }
    });

    it('caps plusOneAllocations: null to 0 for authenticated guests and promotes pending edits to attending', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url === '/api/schedule') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Alex Guest',
              plusOneAllocations: null,
              rsvpOpen: true,
              timezone: 'America/Los_Angeles',
              data: [
                {
                  id: 'se-dinner',
                  title: 'Plated Dinner',
                  startTime: '2026-09-19T18:00:00.000Z',
                  category: 'Reception',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [{ id: 'm-1', label: 'Filet Mignon', dietaryTags: [] }],
                  customQuestions: [
                    { id: 'q-1', prompt: 'Shuttle needed?', type: 'text', required: true, options: [] },
                  ],
                  userRsvp: {
                    status: 'pending',
                    plusOneCount: 0,
                    dietaryNotes: 'No peanuts',
                  },
                },
              ],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      });

      render(
        <InteractiveTimeline events={[]} timezone="America/Los_Angeles" emptyStateMessage="No events" />
      );

      const card = await screen.findByTestId('rsvp-card-se-dinner');
      const plusOneInput = within(card).getByLabelText(/plus-one count/i) as HTMLInputElement;
      expect(plusOneInput).toBeDisabled();
      expect(plusOneInput).toHaveAttribute('max', '0');

      // Pre-populated dietary notes are shown
      const dietaryInput = within(card).getByLabelText(/dietary requirements \/ notes/i) as HTMLInputElement;
      expect(dietaryInput.value).toBe('No peanuts');

      // Meal and custom question sections are hidden while unresponded ('pending')
      expect(within(card).queryByTestId('rsvp-meals-se-dinner')).not.toBeInTheDocument();

      // Editing dietary notes automatically promotes status to 'attending' and reveals meal & question inputs
      fireEvent.change(dietaryInput, { target: { value: 'No peanuts or tree nuts' } });
      expect(within(card).getByRole('radio', { name: /^attending$/i })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(within(card).getByTestId('rsvp-meals-se-dinner')).toBeInTheDocument();
      expect(within(card).getByTestId('rsvp-questions-se-dinner')).toBeInTheDocument();
    });

    it('shares companion names across timeline cards, blocks blank companion names on meals, and keeps removed selections visible', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url === '/api/schedule') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Jane Doe',
              plusOneAllocations: 1,
              savedPlusOneNames: [],
              rsvpOpen: true,
              timezone: 'UTC',
              data: [
                {
                  id: 'se-welcome',
                  title: 'Welcome Cocktails',
                  description: 'Drinks',
                  startTime: '2026-06-19T19:00:00Z',
                  endTime: '2026-06-19T21:00:00Z',
                  locationName: 'Terrace',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [],
                  customQuestions: [],
                  userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
                },
                {
                  id: 'se-dinner',
                  title: 'Reception Dinner',
                  description: 'Dinner',
                  startTime: '2026-06-20T18:00:00Z',
                  endTime: '2026-06-20T22:00:00Z',
                  locationName: 'Ballroom',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [{ id: 'm-active', label: 'Herb Chicken', dietaryTags: [] }],
                  customQuestions: [
                    {
                      id: 'q-bus',
                      prompt: 'Bus route',
                      type: 'choice',
                      required: false,
                      options: ['Downtown Route'],
                    },
                  ],
                  userRsvp: {
                    status: 'attending',
                    plusOneCount: 1,
                    dietaryNotes: '',
                    mealSelections: ['m-removed-dish', 'm-active'],
                    customAnswers: { 'q-bus': 'Legacy Hotel Route' },
                    plusOneNames: [''],
                  },
                },
              ],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      });

      render(<InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events" />);

      const welcomeCard = await screen.findByTestId('rsvp-card-se-welcome');
      const dinnerCard = await screen.findByTestId('rsvp-card-se-dinner');

      // Removed meal option and removed choice option remain visible as selected values
      const primaryMealSelect = within(dinnerCard).getByLabelText(
        /^Entrée for Jane Doe/i
      ) as HTMLSelectElement;
      expect(primaryMealSelect.value).toBe('m-removed-dish');
      expect(within(primaryMealSelect).getByText(/m-removed-dish/i)).toBeInTheDocument();

      const busSelect = within(dinnerCard).getByLabelText('Bus route') as HTMLSelectElement;
      expect(busSelect.value).toBe('Legacy Hotel Route');
      expect(within(busSelect).getByText(/Legacy Hotel Route/i)).toBeInTheDocument();

      // Saving meal event with blank companion name is blocked
      fireEvent.change(primaryMealSelect, { target: { value: 'm-active' } });
      fireEvent.click(within(dinnerCard).getByRole('button', { name: 'Save RSVP' }));
      expect(await within(dinnerCard).findByRole('alert')).toHaveTextContent(/companion|plus-one/i);

      // Typing companion name on Welcome Cocktails shares it into Reception Dinner
      fireEvent.click(within(welcomeCard).getByRole('radio', { name: /^attending$/i }));
      fireEvent.change(within(welcomeCard).getByLabelText(/plus-one count/i), {
        target: { value: '1' },
      });
      fireEvent.change(within(welcomeCard).getByLabelText('Plus-One Full Name'), {
        target: { value: 'Morgan Guest' },
      });

      const dinnerPlusOneInput = within(dinnerCard).getByLabelText(
        'Plus-One Full Name'
      ) as HTMLInputElement;
      expect(dinnerPlusOneInput.value).toBe('Morgan Guest');
    });

    it('renders joined locationName and street location with an accessible Get Directions link', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url === '/api/schedule') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              isGuest: false,
              timezone: 'America/Chicago',
              data: [
                {
                  id: 'se-dir-1',
                  title: 'Garden Ceremony',
                  startTime: '2026-06-20T16:00:00.000Z',
                  locationName: 'Rose Pavilion',
                  location: '1000 Lake Cook Rd, Glencoe, IL 60022',
                  category: 'Ceremony',
                  isPrivate: false,
                },
              ],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      });

      const { container } = render(
        <InteractiveTimeline events={[]} timezone="America/Chicago" emptyStateMessage="No events" />
      );

      expect(
        await screen.findByText('Rose Pavilion, 1000 Lake Cook Rd, Glencoe, IL 60022')
      ).toBeInTheDocument();

      const dirLink = screen.getByRole('link', {
        name: /Get directions to Rose Pavilion, 1000 Lake Cook Rd, Glencoe, IL 60022/i,
      });
      expect(dirLink).toHaveClass('min-h-11', 'min-w-11');
      expect(dirLink).toHaveAttribute(
        'href',
        'https://www.google.com/maps/dir/?api=1&destination=Rose%20Pavilion%2C%201000%20Lake%20Cook%20Rd%2C%20Glencoe%2C%20IL%2060022'
      );
      expect(dirLink).toHaveAttribute('target', '_blank');
      expect(dirLink).toHaveAttribute('rel', 'noopener noreferrer');

      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();
    });

    it('hides required asterisks with aria-hidden, omits autocomplete="name" on plus-one names, focuses first invalid control, keeps focus during saves, and mounts at most one role="alert"', async () => {
      const saveDeferred: { resolve?: (val: unknown) => void } = {};
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/api/schedule') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              isGuest: true,
              guestName: 'Jane Doe',
              plusOneAllocations: 1,
              savedPlusOneNames: [],
              rsvpOpen: true,
              timezone: 'UTC',
              data: [
                {
                  id: 'se-a11y-1',
                  title: 'Plated Dinner',
                  startTime: '2026-06-20T18:00:00Z',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [{ id: 'm-1', label: 'Salmon', dietaryTags: [] }],
                  customQuestions: [
                    {
                      id: 'q-req',
                      prompt: 'Shuttle seat?',
                      type: 'choice',
                      required: true,
                      options: ['Yes', 'No'],
                    },
                  ],
                  userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
                },
                {
                  id: 'se-a11y-2',
                  title: 'Farewell Brunch',
                  startTime: '2026-06-21T10:00:00Z',
                  isPrivate: false,
                  isReadOnly: false,
                  mealOptions: [{ id: 'm-2', label: 'Waffles', dietaryTags: [] }],
                  customQuestions: [],
                  userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
                },
              ],
            }),
          });
        }
        if (url === '/api/rsvp') {
          return new Promise((resolve) => {
            saveDeferred.resolve = resolve;
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      const { container } = render(
        <InteractiveTimeline events={[]} timezone="UTC" emptyStateMessage="No events" />
      );

      const card1 = await screen.findByTestId('rsvp-card-se-a11y-1');
      const card2 = screen.getByTestId('rsvp-card-se-a11y-2');

      // Plus-one name input is required + aria-required="true" without autocomplete="name"
      const plusOneNameInput = within(card1).getByLabelText('Plus-One Full Name');
      expect(plusOneNameInput).toBeRequired();
      expect(plusOneNameInput).toHaveAttribute('aria-required', 'true');
      expect(plusOneNameInput).not.toHaveAttribute('autocomplete', 'name');

      // Every visible asterisk in RSVP cards is hidden with aria-hidden="true"
      const mealSelect = within(card1).getByLabelText(/^Entrée for Jane Doe/i);
      const shuttleSelect = within(card1).getByLabelText(/^Shuttle seat\?/i);
      expect(mealSelect).toBeRequired();
      expect(mealSelect).toHaveAttribute('aria-required', 'true');
      expect(shuttleSelect).toBeRequired();
      expect(shuttleSelect).toHaveAttribute('aria-required', 'true');

      const asteriskElements = Array.from(card1.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 && el.textContent?.trim() === '*'
      );
      expect(asteriskElements.length).toBeGreaterThanOrEqual(3);
      asteriskElements.forEach((el) => {
        expect(el).toHaveAttribute('aria-hidden', 'true');
      });

      // Attempting to save a pending card marks the RSVP radiogroup aria-invalid and focuses Attending radio
      const saveCard2PendingBtn = within(card2).getByRole('button', { name: 'Save RSVP' });
      const card2AttendingRadio = within(card2).getByRole('radio', { name: /^attending$/i });
      saveCard2PendingBtn.focus();
      fireEvent.click(saveCard2PendingBtn);

      await waitFor(() => {
        expect(
          within(card2).getByRole('radiogroup', { name: /Your RSVP for Farewell Brunch/i })
        ).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(card2AttendingRadio);
      });
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(await axe(container)).toHaveNoViolations();

      // Dirty both cards without selecting required meals -> Batch Save fails client validation
      fireEvent.change(within(card1).getByLabelText(/Dietary Requirements/i), {
        target: { value: 'Gluten free' },
      });
      fireEvent.click(within(card2).getByRole('radio', { name: /^attending$/i }));

      const saveAllBtn = screen.getByRole('button', { name: /save all modified events/i });
      saveAllBtn.focus();
      fireEvent.click(saveAllBtn);

      // Single active role="alert" across batch + cards + FormMessages, and first invalid control focused
      await waitFor(() => {
        expect(mealSelect).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(plusOneNameInput);
      });
      expect(mealSelect).toHaveAttribute('aria-describedby');
      expect(plusOneNameInput).toHaveAttribute('aria-invalid', 'true');
      expect(shuttleSelect).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(await axe(container)).toHaveNoViolations();

      // Complete valid inputs and verify Save RSVP keeps focus on button while busy
      fireEvent.change(plusOneNameInput, { target: { value: 'Jordan Taylor' } });
      fireEvent.change(mealSelect, { target: { value: 'm-1' } });
      fireEvent.change(within(card1).getByLabelText(/^Entrée for Jordan Taylor/i), {
        target: { value: 'm-1' },
      });
      fireEvent.change(shuttleSelect, { target: { value: 'Yes' } });
      fireEvent.change(within(card2).getByLabelText(/^Entrée for Jane Doe/i), {
        target: { value: 'm-2' },
      });

      const saveCard1Btn = within(card1).getByRole('button', { name: 'Save RSVP' });
      saveCard1Btn.focus();
      fireEvent.click(saveCard1Btn);

      expect(document.activeElement).toBe(saveCard1Btn);
      expect(saveCard1Btn).not.toBeDisabled();
      expect(saveCard1Btn).toHaveAttribute('aria-busy', 'true');
      expect(saveCard1Btn).toHaveAttribute('aria-disabled', 'true');

      saveDeferred.resolve?.({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'r-saved-1',
              subEventId: 'se-a11y-1',
              status: 'attending',
              plusOneCount: 1,
              plusOneNames: ['Jordan Taylor'],
              mealSelections: ['m-1', 'm-1'],
              customAnswers: { 'q-req': 'Yes' },
              dietaryNotes: '',
            },
          ],
        }),
      });

      expect(await within(card1).findByText('RSVP submitted successfully!')).toBeInTheDocument();
    });
  });
});
