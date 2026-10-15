import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useShareItem } from '../useShareItem';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('useShareItem', () => {
  let originalShare: any;
  let originalClipboard: any;
  let originalExecCommand: any;

  const mockItem = {
    id: 'test-item-123',
    name: 'Silver Coffee Maker',
  };

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(ToastProvider, null, children);

  beforeEach(() => {
    originalShare = navigator.share;
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: originalShare, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, writable: true, configurable: true });
    document.execCommand = originalExecCommand;
    jest.useRealTimers();
  });

  it('uses Web Share API when available and calls navigator.share', async () => {
    const mockShare = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockShare).toHaveBeenCalledWith({
      title: 'Silver Coffee Maker',
      text: 'Check out Silver Coffee Maker on our wedding registry!',
      url: expect.stringContaining('?item=test-item-123'),
    });
    expect(result.current.copied).toBe(true);
  });

  it('suppresses AbortError silently when user cancels native share sheet', async () => {
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    const mockShare = jest.fn().mockRejectedValue(abortError);
    const mockWriteText = jest.fn();

    Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, writable: true, configurable: true });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockShare).toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(result.current.copied).toBe(false);
  });

  it('falls back to navigator.clipboard.writeText when navigator.share is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, writable: true, configurable: true });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('?item=test-item-123'));
    expect(result.current.copied).toBe(true);
  });

  it('falls back to document.execCommand when Web Share and Clipboard API are unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true, configurable: true });

    const mockExecCommand = jest.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand;

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockExecCommand).toHaveBeenCalledWith('copy');
    expect(result.current.copied).toBe(true);
  });

  it('handles failure when all share and clipboard fallbacks fail', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('Permission denied')) },
      writable: true,
      configurable: true,
    });
    document.execCommand = jest.fn().mockImplementation(() => {
      throw new Error('execCommand failed');
    });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(result.current.copied).toBe(false);
  });

  it('resets copied state to false after 2000ms timeout', async () => {
    jest.useFakeTimers();
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, writable: true, configurable: true });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    await act(async () => {
      await result.current.handleShare();
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.copied).toBe(false);
  });

  it('prevents default and stops propagation when event is passed', async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, writable: true, configurable: true });

    const { result } = renderHook(() => useShareItem(mockItem), { wrapper });

    const mockEvent = {
      stopPropagation: jest.fn(),
      preventDefault: jest.fn(),
    };

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('functions safely when rendered outside of ToastProvider context', async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, writable: true, configurable: true });

    // Render without ToastProvider wrapper
    const { result } = renderHook(() => useShareItem(mockItem));

    await act(async () => {
      await result.current.handleShare();
    });

    expect(result.current.copied).toBe(true);
  });
});
