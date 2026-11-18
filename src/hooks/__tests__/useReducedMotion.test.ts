import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from '../useReducedMotion';

describe('useReducedMotion', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    jest.restoreAllMocks();
  });

  it('returns initial matches state when prefers-reduced-motion is false', () => {
    const addEventListener = jest.fn();
    const removeEventListener = jest.fn();
    const matchMediaMock = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener,
      removeEventListener,
      dispatchEvent: jest.fn(),
    }));

    window.matchMedia = matchMediaMock;

    const { result } = renderHook(() => useReducedMotion());

    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(result.current).toBe(false);
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('returns initial matches state when prefers-reduced-motion is true', () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  it('updates state on change events and removes listener on unmount', () => {
    let changeHandler: ((_e: MediaQueryListEvent) => void) | null = null;
    const addEventListener = jest.fn((event: string, handler: (_e: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        changeHandler = handler;
      }
    });
    const removeEventListener = jest.fn();

    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener,
      removeEventListener,
      dispatchEvent: jest.fn(),
    }));

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    expect(changeHandler).not.toBeNull();

    act(() => {
      changeHandler?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);

    act(() => {
      changeHandler?.({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current).toBe(false);

    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('change', changeHandler);
  });

  it('defaults to false and does not throw when window.matchMedia is missing', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result, unmount } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
    expect(() => unmount()).not.toThrow();
  });

  it('handles partial MediaQueryList mocks without listener methods safely', () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
    } as unknown as MediaQueryList);

    const { result, unmount } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
    expect(() => unmount()).not.toThrow();
  });

  it('handles partial MediaQueryList mocks missing removeEventListener or returning undefined', () => {
    const addEventListener = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener,
    } as unknown as MediaQueryList);

    const { result, unmount } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(() => unmount()).not.toThrow();

    window.matchMedia = jest.fn().mockReturnValue(undefined as unknown as MediaQueryList);
    const { result: undefinedResult, unmount: unmountUndefined } = renderHook(() => useReducedMotion());

    expect(undefinedResult.current).toBe(false);
    expect(() => unmountUndefined()).not.toThrow();
  });
});
