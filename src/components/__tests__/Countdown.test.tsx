import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Countdown from '../Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders days, hours, minutes, and seconds remaining post-mount', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    // 10 days, 5 hours, 3 minutes, 12 seconds in the future
    const targetDate = new Date('2026-10-25T17:03:12Z');

    render(<Countdown targetDate={targetDate.toISOString()} />);

    expect(screen.getByRole('timer')).toHaveTextContent('10 days 5 hours 3 minutes 12 seconds to go!');
  });

  it('provides proper ARIA attributes and focus management with dedicated live region', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    const { container } = render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    expect(timer).not.toHaveAttribute('aria-live');
    expect(timer).not.toHaveAttribute('aria-atomic');
    expect(timer).toHaveAttribute('tabIndex', '0');
    expect(timer).toHaveAttribute('aria-label', '10 days, 5 hours, 3 minutes, 12 seconds to go!');

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveClass('sr-only');
    expect(container.querySelectorAll('.sr-only')).toHaveLength(1);
  });

  it('responds to keyboard events (Space and Enter) with state feedback announcements', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    const liveRegion = screen.getByRole('status');

    fireEvent.keyDown(timer, { key: ' ' });
    expect(liveRegion).toHaveTextContent('Countdown status: 10 days, 5 hours, 3 minutes, 12 seconds to go!');
    expect(timer).toHaveAttribute('aria-label', '10 days, 5 hours, 3 minutes, 12 seconds to go!');

    fireEvent.keyDown(timer, { key: 'Enter' });
    expect(liveRegion).toHaveTextContent('Countdown status: 10 days, 5 hours, 3 minutes, 12 seconds to go!');
    expect(timer).toHaveAttribute('aria-label', '10 days, 5 hours, 3 minutes, 12 seconds to go!');
  });

  it('updates sub-day time units every second', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-15T12:00:05Z'); // 5 seconds in future

    render(<Countdown targetDate={targetDate.toISOString()} />);

    expect(screen.getByRole('timer')).toHaveTextContent('0 days 0 hours 0 minutes 5 seconds to go!');

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('0 days 0 hours 0 minutes 4 seconds to go!');
  });

  it('stops the timer and renders "The wedding day is here!" when target date has passed', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-15T12:00:02Z'); // 2 seconds in future

    render(<Countdown targetDate={targetDate.toISOString()} />);

    expect(screen.getByRole('timer')).toHaveTextContent('0 days 0 hours 0 minutes 2 seconds to go!');

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveTextContent('The wedding day is here!');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('renders "The wedding day is here!" when target date has passed initially', () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 2); // 2 days in the past
    const targetDateStr = targetDate.toISOString();

    render(<Countdown targetDate={targetDateStr} />);

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveTextContent('The wedding day is here!');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('updates the live region on consecutive Space or Enter key presses without dropped speech events', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    const liveRegion = screen.getByRole('status');

    fireEvent.keyDown(timer, { key: ' ' });
    const firstText = liveRegion.textContent;
    expect(liveRegion).toHaveTextContent('Countdown status: 10 days, 5 hours, 3 minutes, 12 seconds to go!');

    fireEvent.keyDown(timer, { key: ' ' });
    const secondText = liveRegion.textContent;
    expect(liveRegion).toHaveTextContent('Countdown status: 10 days, 5 hours, 3 minutes, 12 seconds to go!');
    expect(secondText).not.toBe(firstText);

    fireEvent.keyDown(timer, { key: 'Enter' });
    const thirdText = liveRegion.textContent;
    expect(liveRegion).toHaveTextContent('Countdown status: 10 days, 5 hours, 3 minutes, 12 seconds to go!');
    expect(thirdText).not.toBe(secondText);
  });

  it('completely cleans up and clears all background scheduled tasks whenever unmounted', () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 10);
    const targetDateStr = targetDate.toISOString();

    const { unmount } = render(<Countdown targetDate={targetDateStr} />);

    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
