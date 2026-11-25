import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { a11yConfig } from '@/a11y-config';
import Countdown from '../Countdown';
import { createCountdownClockStore, formatTimeLeftFromTicks } from '../countdownClock';

expect.extend(toHaveNoViolations);

describe('Countdown', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders days, hours, minutes, and seconds remaining post-mount', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    // 10 days, 5 hours, 3 minutes, 12 seconds in the future
    const targetDate = new Date('2026-10-25T17:03:12Z');

    render(<Countdown targetDate={targetDate.toISOString()} />);

    expect(screen.getByRole('timer')).toHaveTextContent('10 days 5 hours 3 minutes 12 seconds to go!');
  });

  it('renders a non-focusable timer without per-second aria-label mutations alongside a Pause countdown button', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    const { container } = render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(timer).not.toHaveAttribute('tabIndex');
    expect(timer).not.toHaveAttribute('aria-label');

    const pauseBtn = screen.getByRole('button', { name: 'Pause countdown' });
    expect(pauseBtn).toHaveAttribute('type', 'button');
    expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    // Advance clock and verify aria-label is never added or mutated on role="timer"
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(timer).not.toHaveAttribute('aria-label');
    expect(timer).toHaveTextContent('10 days 5 hours 3 minutes 11 seconds to go!');

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveClass('sr-only');
    expect(container.querySelectorAll('.sr-only')).toHaveLength(1);
  });

  it('pauses and resumes the countdown via the toggle button and announces state changes politely', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    const liveRegion = screen.getByRole('status');
    const toggleBtn = screen.getByTestId('countdown-pause-btn');

    expect(toggleBtn).toHaveTextContent('Pause countdown');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    expect(jest.getTimerCount()).toBe(1);

    // Pause countdown
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('Resume countdown');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    expect(jest.getTimerCount()).toBe(0);
    expect(liveRegion).toHaveTextContent(
      'Countdown paused: 10 days, 5 hours, 3 minutes, 12 seconds to go!'
    );

    // Advance 5 seconds while paused: timer readout stays frozen
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(timer).toHaveTextContent('10 days 5 hours 3 minutes 12 seconds to go!');

    // Resume countdown: syncs to live remaining time and restarts 1-second updates
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('Pause countdown');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    expect(jest.getTimerCount()).toBe(1);
    expect(timer).toHaveTextContent('10 days 5 hours 3 minutes 7 seconds to go!');
    expect(liveRegion).toHaveTextContent(
      'Countdown resumed: 10 days, 5 hours, 3 minutes, 7 seconds to go!'
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(timer).toHaveTextContent('10 days 5 hours 3 minutes 6 seconds to go!');
  });

  it('starts paused with zero 1-second timer ticks under prefers-reduced-motion: reduce and allows manual resume', () => {
    let changeHandler: ((_e: MediaQueryListEvent) => void) | null = null;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: (_evt: string, cb: (_e: MediaQueryListEvent) => void) => {
        changeHandler = cb;
      },
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);
    const targetDate = new Date('2026-10-15T12:00:10Z');

    render(<Countdown targetDate={targetDate.toISOString()} />);

    const timer = screen.getByRole('timer');
    const toggleBtn = screen.getByRole('button', { name: 'Resume countdown' });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    expect(jest.getTimerCount()).toBe(0);
    expect(timer).toHaveTextContent('0 days 0 hours 0 minutes 10 seconds to go!');

    // Time advances with zero ticks
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(timer).toHaveTextContent('0 days 0 hours 0 minutes 10 seconds to go!');

    // Guest manually resumes countdown
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: 'Pause countdown' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(jest.getTimerCount()).toBe(1);
    expect(timer).toHaveTextContent('0 days 0 hours 0 minutes 6 seconds to go!');

    // If OS reduced-motion preference toggles off then back on, countdown pauses automatically
    act(() => {
      changeHandler?.({ matches: false } as MediaQueryListEvent);
    });
    act(() => {
      changeHandler?.({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByRole('button', { name: 'Resume countdown' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refreshes frozen snapshot cleanly when targetDate prop changes while paused', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const firstTarget = new Date('2026-10-15T12:00:10Z');
    const secondTarget = new Date('2026-10-16T12:00:00Z');

    const { rerender } = render(<Countdown targetDate={firstTarget.toISOString()} />);
    fireEvent.click(screen.getByTestId('countdown-pause-btn'));
    expect(jest.getTimerCount()).toBe(0);
    expect(screen.getByRole('timer')).toHaveTextContent('0 days 0 hours 0 minutes 10 seconds to go!');

    rerender(<Countdown targetDate={secondTarget.toISOString()} />);
    expect(jest.getTimerCount()).toBe(0);
    expect(screen.getByRole('timer')).toHaveTextContent('1 day 0 hours 0 minutes 0 seconds to go!');

    // Also handles non-finite target timestamps safely in countdownClock helpers
    const invalidStore = createCountdownClockStore(Number.NaN);
    expect(invalidStore.getSnapshot(true)).toBe(0);
    expect(formatTimeLeftFromTicks(0)).toEqual({});
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

  it('stops the timer and renders non-focusable "The wedding day is here!" when target date has passed', () => {
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
    expect(statusRegion).not.toHaveAttribute('tabIndex');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('countdown-pause-btn')).not.toBeInTheDocument();
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
    expect(statusRegion).not.toHaveAttribute('tabIndex');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('updates the live region on consecutive pause/resume toggles within the same second without dropped speech events', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);

    const targetDate = new Date('2026-10-25T17:03:12Z');
    render(<Countdown targetDate={targetDate.toISOString()} />);

    const toggleBtn = screen.getByTestId('countdown-pause-btn');
    const liveRegion = screen.getByRole('status');

    fireEvent.click(toggleBtn);
    const firstPausedText = liveRegion.textContent;
    expect(liveRegion).toHaveTextContent(
      'Countdown paused: 10 days, 5 hours, 3 minutes, 12 seconds to go!'
    );

    fireEvent.click(toggleBtn);
    expect(liveRegion).toHaveTextContent(
      'Countdown resumed: 10 days, 5 hours, 3 minutes, 12 seconds to go!'
    );

    fireEvent.click(toggleBtn);
    expect(liveRegion).toHaveTextContent(
      'Countdown paused: 10 days, 5 hours, 3 minutes, 12 seconds to go!'
    );
    expect(liveRegion.textContent).toBe(firstPausedText);
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

  it('passes automated jest-axe accessibility checks in running, paused, and completed states', async () => {
    const now = new Date('2026-10-15T12:00:00Z');
    jest.setSystemTime(now);
    const targetDate = new Date('2026-10-25T17:03:12Z');

    const { container, unmount } = render(<Countdown targetDate={targetDate.toISOString()} />);
    jest.useRealTimers();

    const axeOptions = {
      ...a11yConfig,
      rules: {
        ...a11yConfig.rules,
        'label-content-name-mismatch': { enabled: true },
      },
    };

    expect(await axe(container, axeOptions)).toHaveNoViolations();

    fireEvent.click(screen.getByTestId('countdown-pause-btn'));
    expect(await axe(container, axeOptions)).toHaveNoViolations();

    unmount();

    const pastDate = new Date('2020-01-01T00:00:00Z');
    const { container: completedContainer } = render(
      <Countdown targetDate={pastDate.toISOString()} />
    );
    expect(await axe(completedContainer, axeOptions)).toHaveNoViolations();
  });
});
