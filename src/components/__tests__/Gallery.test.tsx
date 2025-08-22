import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Gallery from '../Gallery';

const mockNext = jest.fn();
let createdCallback: (() => void) | undefined;

jest.mock('keen-slider/react', () => ({
  useKeenSlider: (options: { created: () => void }) => {
    createdCallback = options.created;
    return [jest.fn(), { current: { next: mockNext } }];
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

    // Placeholder before slider initialization
    expect(screen.getByTestId('loading-placeholder')).toBeInTheDocument();

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
});
