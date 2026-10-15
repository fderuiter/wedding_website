import { render, screen, act } from '@testing-library/react';
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

    expect(screen.getAllByText(/The wedding day is here!/i)[0]).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('renders "The wedding day is here!" when target date has passed initially', () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 2); // 2 days in the past
    const targetDateStr = targetDate.toISOString();

    render(<Countdown targetDate={targetDateStr} />);

    expect(screen.getAllByText(/The wedding day is here!/i)[0]).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);
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
