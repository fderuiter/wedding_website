import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Countdown from '../Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders countdown to target date', () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 10); // 10 days in the future
    const targetDateStr = targetDate.toISOString();

    render(<Countdown targetDate={targetDateStr} />);

    expect(screen.getByRole('timer')).toHaveTextContent(/10 days to go!/i);
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
