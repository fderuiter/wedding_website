import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Gallery from '../Gallery';

const mockNext = jest.fn();

jest.mock('keen-slider/react', () => ({
  useKeenSlider: () => {
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

  it('renders images, advances slides automatically, and clears interval on unmount', () => {
    const images = [
      { src: '/img1.jpg', alt: 'Image 1' },
      { src: '/img2.jpg', alt: 'Image 2' },
    ];

    const { unmount } = render(<Gallery images={images} autoplayDelay={1000} />);

    // Images render immediately
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
