import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeddingIntro from '../WeddingIntro';

// Mock heavy Three.js-related modules to simple components
jest.mock('@react-three/fiber', () => ({
  Canvas: () => <div />, // Do not render children to avoid unknown tags
  useFrame: jest.fn(),
}));

jest.mock('@react-three/drei', () => ({
  Environment: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Float: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bloom: () => null,
}));

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));

// Mock the canvas context to prevent errors when Three.js tries to access it
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: jest.fn(() => ({} as CanvasRenderingContext2D)),
  });
});

describe('WeddingIntro', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls onFinish after the heart duration', () => {
    const onFinish = jest.fn();
    render(<WeddingIntro onFinish={onFinish} />);

    // Advance timers by CONFIG.HEART_DURATION * 1000 (6 seconds)
    act(() => {
      jest.advanceTimersByTime(6 * 1000);
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does not call onFinish after unmounting before the heart duration', () => {
    const onFinish = jest.fn();
    const { unmount } = render(<WeddingIntro onFinish={onFinish} />);

    // Unmount before timers complete
    unmount();

    // Advance timers past CONFIG.HEART_DURATION * 1000 (6 seconds)
    act(() => {
      jest.advanceTimersByTime(6 * 1000 + 100);
    });

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('renders within a mocked canvas environment without crashing', () => {
    const onFinish = jest.fn();
    expect(() => render(<WeddingIntro onFinish={onFinish} />)).not.toThrow();
  });
});
