import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import BackToTop from '../BackToTop';

describe('BackToTop', () => {
  beforeAll(() => {
    const g = global as unknown as {
      requestAnimationFrame: (cb: FrameRequestCallback) => number;
      cancelAnimationFrame: (id: number) => void;
    };
    g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  });

  it('toggles visibility based on scroll position and retains ARIA label', async () => {
    Object.defineProperty(window, 'scrollY', { writable: true, value: 0 });

    render(<BackToTop />);
    const link = screen.getByRole('link', { name: /back to top/i });

    await waitFor(() => {
      expect(link).toHaveClass('opacity-0');
      expect(link).toHaveClass('pointer-events-none');
    });
    expect(link).toHaveAttribute('aria-label', 'Back to top');

    window.scrollY = 700;
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(link).toHaveClass('opacity-100');
      expect(link).toHaveClass('pointer-events-auto');
    });
    expect(link).toHaveAttribute('aria-label', 'Back to top');

    window.scrollY = 100;
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(link).toHaveClass('opacity-0');
      expect(link).toHaveClass('pointer-events-none');
    });
    expect(link).toHaveAttribute('aria-label', 'Back to top');
  });

  it('cleans up scroll listener and animation frame on unmount', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame');

    const { unmount } = render(<BackToTop />);
    const scrollHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'scroll',
    )?.[1] as EventListener;

    cancelAnimationFrameSpy.mockClear();
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', scrollHandler);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(1);

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });
});
