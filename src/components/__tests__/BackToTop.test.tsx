import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    // Mock window.scrollTo
    Object.defineProperty(window, 'scrollTo', {
      value: jest.fn(),
      writable: true,
    });
  });

  it('toggles visibility based on scroll position and retains ARIA label', async () => {
    Object.defineProperty(window, 'scrollY', { writable: true, value: 0 });

    render(<BackToTop />);
    const button = screen.getByRole('button', { hidden: true });

    await waitFor(() => {
      expect(button).toHaveClass('opacity-0');
      expect(button).toHaveClass('pointer-events-none');
      expect(button).toHaveAttribute('tabindex', '-1');
      expect(button).toHaveAttribute('aria-hidden', 'true');
    });
    expect(button).toHaveAttribute('aria-label', 'Back to top');

    window.scrollY = 700;
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(button).toHaveClass('opacity-100');
      expect(button).toHaveClass('pointer-events-auto');
      expect(button).toHaveAttribute('tabindex', '0');
      expect(button).toHaveAttribute('aria-hidden', 'false');
    });
    expect(button).toHaveAttribute('aria-label', 'Back to top');

    window.scrollY = 100;
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(button).toHaveClass('opacity-0');
      expect(button).toHaveClass('pointer-events-none');
      expect(button).toHaveAttribute('tabindex', '-1');
      expect(button).toHaveAttribute('aria-hidden', 'true');
    });
    expect(button).toHaveAttribute('aria-label', 'Back to top');
  });

  it('scrolls to top when clicked', async () => {
    window.scrollY = 700;
    render(<BackToTop />);
    const button = screen.getByRole('button', { hidden: true });

    await waitFor(() => {
      expect(button).toHaveClass('opacity-100');
    });

    fireEvent.click(button);

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
  });

  it('scrolls to top on Enter or Space key press', async () => {
    window.scrollY = 700;
    render(<BackToTop />);
    const button = screen.getByRole('button', { hidden: true });

    await waitFor(() => {
      expect(button).toHaveClass('opacity-100');
    });

    (window.scrollTo as jest.Mock).mockClear();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });

    (window.scrollTo as jest.Mock).mockClear();
    fireEvent.keyDown(button, { key: ' ' });
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
  });

  it('manages focus when main-content element is present', async () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    document.body.appendChild(main);

    window.scrollY = 700;
    render(<BackToTop />);
    const button = screen.getByRole('button', { hidden: true });

    await waitFor(() => {
      expect(button).toHaveClass('opacity-100');
    });

    fireEvent.click(button);
    expect(document.activeElement).toBe(main);

    document.body.removeChild(main);
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
