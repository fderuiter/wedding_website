import { renderHook, act } from '@testing-library/react';
import { useUnified3DInput } from '../useUnified3DInput';

describe('useUnified3DInput', () => {
  let mockElement: HTMLElement;
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    mockElement = document.createElement('div');
    getBoundingClientRectSpy = jest.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 100,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries getBoundingClientRect only ONCE per gesture session during pointer moves', () => {
    const domRef = { current: mockElement };
    const onDragMove = jest.fn();

    const { result } = renderHook(() =>
      useUnified3DInput({
        domRef,
        onDragMove,
      })
    );

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(0);

    // Pointer down starts gesture and caches rect
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 110,
        clientY: 70,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);

    // Continuous pointer moves reuse cached rect and do NOT call getBoundingClientRect again
    act(() => {
      result.current.handlers.onPointerMove({
        clientX: 160,
        clientY: 90,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalledTimes(1);
    expect(onDragMove.mock.calls[0][0].x).toBeCloseTo(0.25);
    expect(onDragMove.mock.calls[0][0].y).toBeCloseTo(0.2);

    act(() => {
      result.current.handlers.onPointerMove({
        clientX: 110,
        clientY: 70,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalledTimes(2);

    // Pointer up ends gesture and clears cache
    act(() => {
      result.current.handlers.onPointerUp({
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);

    // Subsequent gesture session calls getBoundingClientRect once more
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 110,
        clientY: 70,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(2);
  });

  it('resets cached rect on pointer leave and on destroy', () => {
    const domRef = { current: mockElement };
    const { result } = renderHook(() =>
      useUnified3DInput({
        domRef,
      })
    );

    // Pointer down -> caches rect
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 100,
        clientY: 50,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });
    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);

    // Pointer leave clears cache
    act(() => {
      result.current.handlers.onPointerLeave({
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    // Next pointer down re-fetches rect
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 100,
        clientY: 50,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });
    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(2);

    // Destroy clears cache and disables input
    act(() => {
      result.current.lifecycle.destroy();
    });

    // Reconstruct re-enables input
    act(() => {
      result.current.lifecycle.reconstruct();
    });

    // Pointer down re-fetches rect
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 100,
        clientY: 50,
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });
    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(3);
  });

  it('works with touch events', () => {
    const domRef = { current: mockElement };
    const onDragMove = jest.fn();

    const { result } = renderHook(() =>
      useUnified3DInput({
        domRef,
        onDragMove,
      })
    );

    act(() => {
      result.current.handlers.onTouchStart({
        touches: [{ clientX: 110, clientY: 70 }],
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 160, clientY: 90 }],
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handlers.onTouchEnd({
        target: mockElement,
        stopPropagation: jest.fn(),
      });
    });

    expect(getBoundingClientRectSpy).toHaveBeenCalledTimes(1);
  });
});
