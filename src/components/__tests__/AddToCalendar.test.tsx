import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddToCalendar from '../AddToCalendar';
import { CalendarEvent } from '@/utils/calendar';
import * as calendarUtils from '@/utils/calendar';

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

  it('links trigger button to dropdown container with aria-controls', () => {
    render(<AddToCalendar event={sampleEvent} />);
    const trigger = screen.getByRole('button', { name: 'Add to Calendar' });
    expect(trigger).toHaveAttribute('aria-controls', 'add-to-calendar-menu');

    fireEvent.click(trigger);
    const container = document.getElementById('add-to-calendar-menu');
    expect(container).toBeInTheDocument();
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
