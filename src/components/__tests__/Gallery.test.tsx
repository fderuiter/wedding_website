import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Gallery from '../Gallery';

const mockNext = jest.fn();
let createdCallback: (() => void) | undefined;

jest.mock('keen-slider/react', () => ({
  useKeenSlider: (options: { created: () => void }) => {
    createdCallback = options.created;
    const mockSlider = {
      next: mockNext,
      on: jest.fn(),
      destroy: jest.fn(),
    };
    return [jest.fn(), { current: mockSlider }];
  }
}));

describe('Gallery Component', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockNext.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders placeholder, advances slides automatically, and clears interval on unmount', () => {
    const images = [
      { src: '/img1.jpg', alt: 'Image 1' },
      { src: '/img2.jpg', alt: 'Image 2' },
    ];

    const { unmount } = render(<Gallery images={images} autoplayDelay={1000} />);

    // Simulate slider creation
    act(() => {
      createdCallback?.();
    });

    // Images render after creation
    expect(screen.getAllByRole('img')).toHaveLength(2);

    // Autoplay moves to next slide
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockNext).toHaveBeenCalledTimes(1);

    // Interval cleared on unmount
    unmount();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('pauses autoplay on mouse enter and resumes on mouse leave', () => {
    const images = [
      { src: '/img1.jpg', alt: 'Image 1' },
      { src: '/img2.jpg', alt: 'Image 2' },
    ];

    const { unmount, container } = render(<Gallery images={images} autoplayDelay={1000} />);

    // Simulate slider creation
    act(() => {
      createdCallback?.();
    });

    // Verify autoplay works initially
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockNext).toHaveBeenCalledTimes(1);
    mockNext.mockClear();

    // Mouse Enter - should pause
    const sliderContainer = container.querySelector('.keen-slider');
    if (!sliderContainer) throw new Error('Slider container not found');

    act(() => {
        fireEvent.mouseEnter(sliderContainer);
    });

    // Advance time - should NOT call next
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(mockNext).toHaveBeenCalledTimes(0);

    // Mouse Leave - should resume
    act(() => {
        fireEvent.mouseLeave(sliderContainer);
    });

    // Advance time - should call next
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockNext).toHaveBeenCalledTimes(1);

    unmount();
  });
});
