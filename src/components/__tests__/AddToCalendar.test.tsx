import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import AddToCalendar from '../AddToCalendar';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { CalendarEvent } from '@/utils/calendar';
import * as calendarUtils from '@/utils/calendar';

expect.extend(toHaveNoViolations);

// Mock the calendar utility functions
jest.mock('@/utils/calendar', () => ({
  createGoogleCalendarLink: jest.fn(),
  createYahooCalendarLink: jest.fn(),
  createOutlookCalendarLink: jest.fn(),
  createIcsFile: jest.fn(),
}));

// Mock window.open
const mockWindowOpen = jest.fn();
Object.defineProperty(window, 'open', { value: mockWindowOpen });

// Mock URL.createObjectURL and the download link logic
const mockCreateObjectURL = jest.fn(() => 'blob:http://localhost/mock-url');
const mockRevokeObjectURL = jest.fn();
Object.defineProperty(window.URL, 'createObjectURL', { value: mockCreateObjectURL });
Object.defineProperty(window.URL, 'revokeObjectURL', { value: mockRevokeObjectURL });


describe('AddToCalendar', () => {
  const sampleEvent: CalendarEvent = {
    name: 'Sample Event',
    startDate: '2025-10-15',
    startTime: '15:00',
    endDate: '2025-10-15',
    endTime: '23:00',
    timeZone: 'America/New_York',
    location: 'Test Location',
    description: 'Event Description',
  };

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
  });

  it('renders the "Add to Calendar" button', () => {
    render(<AddToCalendar event={sampleEvent} />);
    expect(screen.getByText('Add to Calendar')).toBeInTheDocument();
  });

  it('opens the dropdown when the button is clicked', () => {
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Yahoo')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
  });

  it('calls createGoogleCalendarLink and window.open when Google is clicked', () => {
    (calendarUtils.createGoogleCalendarLink as jest.Mock).mockReturnValue('https://calendar.google.com/render?action=TEMPLATE');
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Google'));

    expect(calendarUtils.createGoogleCalendarLink).toHaveBeenCalledWith(sampleEvent);
    expect(mockWindowOpen).toHaveBeenCalledWith('https://calendar.google.com/render?action=TEMPLATE', '_blank', 'noopener,noreferrer');
  });

  it('calls createYahooCalendarLink and window.open when Yahoo is clicked', () => {
    (calendarUtils.createYahooCalendarLink as jest.Mock).mockReturnValue('https://calendar.yahoo.com/?v=60');
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Yahoo'));

    expect(calendarUtils.createYahooCalendarLink).toHaveBeenCalledWith(sampleEvent);
    expect(mockWindowOpen).toHaveBeenCalledWith('https://calendar.yahoo.com/?v=60', '_blank', 'noopener,noreferrer');
  });

  it('calls createOutlookCalendarLink and window.open when Outlook.com is clicked', () => {
    (calendarUtils.createOutlookCalendarLink as jest.Mock).mockReturnValue('https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose');
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Outlook.com'));

    expect(calendarUtils.createOutlookCalendarLink).toHaveBeenCalledWith(sampleEvent);
    expect(mockWindowOpen).toHaveBeenCalledWith('https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose', '_blank', 'noopener,noreferrer');
  });

  it('calls createIcsFile and triggers a download when Apple is clicked', () => {
    (calendarUtils.createIcsFile as jest.Mock).mockReturnValue('mock ics content');
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Apple'));

    expect(calendarUtils.createIcsFile).toHaveBeenCalledWith(sampleEvent);
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-url');
  });

  it('triggers fetch-backed blob download using downloadUrl prop without client ICS generation', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', {
        status: 200,
        headers: {
          'Content-Type': 'text/calendar',
          'Content-Disposition': 'attachment; filename="custom-event.ics"',
        },
      })
    );
    render(
      <AddToCalendar
        event={sampleEvent}
        downloadUrl="/api/schedule/custom-event-id/ics"
      />
    );
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Apple'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/schedule/custom-event-id/ics');
      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(calendarUtils.createIcsFile).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers fetch-backed blob download using eventId prop', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', {
        status: 200,
        headers: { 'Content-Type': 'text/calendar' },
      })
    );
    render(
      <AddToCalendar
        event={sampleEvent}
        eventId="event-123"
      />
    );
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('iCal'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/schedule/event-123/ics');
      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(calendarUtils.createIcsFile).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers fetch-backed blob download when event has id property and shows error toast on failure', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', {
          status: 200,
          headers: { 'Content-Type': 'text/calendar' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Calendar feed unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    const eventWithId = { ...sampleEvent, id: 'event-with-id' };
    render(
      <ToastProvider>
        <AddToCalendar event={eventWithId} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Apple'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/schedule/event-with-id/ics');
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect(calendarUtils.createIcsFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Add to Calendar'));
    fireEvent.click(screen.getByText('Apple'));
    expect(await screen.findByText('Calendar feed unavailable')).toBeInTheDocument();

    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('closes the dropdown when Escape key is pressed', () => {
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('manages focus with Arrow keys', () => {
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));

    const googleButton = screen.getByText('Google');
    const appleButton = screen.getByText('Apple');

    // Focus should be on the first item (Google) initially or we can set it
    googleButton.focus();
    expect(document.activeElement).toBe(googleButton);

    // Arrow Down -> Apple
    fireEvent.keyDown(googleButton, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(appleButton);

    // Arrow Up -> Google
    fireEvent.keyDown(appleButton, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(googleButton);
  });

  it('returns focus to trigger button on Escape', () => {
    render(<AddToCalendar event={sampleEvent} />);
    const trigger = screen.getByText('Add to Calendar');
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('links trigger button to role="menu" with unique per-instance IDs and passes jest-axe', async () => {
    const { container } = render(
      <div>
        <AddToCalendar event={sampleEvent} eventId="event-a" />
        <AddToCalendar event={{ ...sampleEvent, name: 'Second Event' }} eventId="event-b" />
      </div>
    );

    const triggers = screen.getAllByRole('button', { name: 'Add to Calendar' });
    expect(triggers).toHaveLength(2);

    const firstTriggerId = triggers[0].getAttribute('id');
    const secondTriggerId = triggers[1].getAttribute('id');

    expect(firstTriggerId).toBeTruthy();
    expect(secondTriggerId).toBeTruthy();
    expect(firstTriggerId).not.toBe(secondTriggerId);
    expect(triggers[0]).not.toHaveAttribute('aria-controls');
    expect(triggers[1]).not.toHaveAttribute('aria-controls');

    fireEvent.click(triggers[0]);
    const firstMenuId = triggers[0].getAttribute('aria-controls');
    expect(firstMenuId).toMatch(/^add-to-calendar-menu-/);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('id', firstMenuId);
    expect(menu).toHaveAttribute('aria-labelledby', firstTriggerId);
    expect(document.getElementById(firstMenuId!)).toBe(menu);

    expect(await axe(container)).toHaveNoViolations();

    // Pressing Tab inside the first menu closes it and moves focus sequentially to the second trigger
    const firstMenuItem = screen.getByRole('menuitem', { name: 'Google' });
    fireEvent.keyDown(firstMenuItem, { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(triggers[0]).not.toHaveAttribute('aria-controls');
    expect(triggers[1]).toHaveFocus();

    fireEvent.click(triggers[1]);
    const secondMenuId = triggers[1].getAttribute('aria-controls');
    expect(secondMenuId).toMatch(/^add-to-calendar-menu-/);
    expect(firstMenuId).not.toBe(secondMenuId);
  });

  it('closes an open calendar menu on the first pointer click on its trigger button', () => {
    render(<AddToCalendar event={sampleEvent} />);
    const trigger = screen.getByRole('button', { name: 'Add to Calendar' });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens menu when ArrowDown or ArrowUp key is pressed on closed trigger button', () => {
    const { unmount } = render(<AddToCalendar event={sampleEvent} />);
    const trigger = screen.getByRole('button', { name: 'Add to Calendar' });

    // ArrowDown on closed trigger
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();

    unmount();

    render(<AddToCalendar event={sampleEvent} />);
    const trigger2 = screen.getByRole('button', { name: 'Add to Calendar' });

    // ArrowUp on closed trigger
    fireEvent.keyDown(trigger2, { key: 'ArrowUp' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('navigates to first and last items using Home and End keys', () => {
    render(<AddToCalendar event={sampleEvent} />);
    fireEvent.click(screen.getByText('Add to Calendar'));

    const googleButton = screen.getByText('Google');
    const yahooButton = screen.getByText('Yahoo');

    googleButton.focus();
    expect(document.activeElement).toBe(googleButton);

    // End key moves focus to last item (Yahoo)
    fireEvent.keyDown(googleButton, { key: 'End' });
    expect(document.activeElement).toBe(yahooButton);

    // Home key moves focus to first item (Google)
    fireEvent.keyDown(yahooButton, { key: 'Home' });
    expect(document.activeElement).toBe(googleButton);
  });
});
