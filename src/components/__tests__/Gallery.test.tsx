import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Gallery from '../Gallery';

import { useKeenSlider } from 'keen-slider/react';

jest.mock('keen-slider/react');

const mockUseKeenSlider = useKeenSlider as jest.Mock;

describe('Gallery Component', () => {
  const images = [
    { src: '/img1.jpg', alt: 'Image 1' },
    { src: '/img2.jpg', alt: 'Image 2' },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('renders placeholder, advances slides automatically, and clears interval on unmount', () => {
    const mockNext = jest.fn();
    const mockOn = jest.fn((event, callback) => {
      if (event === 'created') {
        callback();
      }
    });
    const mockDestroy = jest.fn();

    mockUseKeenSlider.mockImplementation(() => [
      jest.fn(),
      {
        current: {
          next: mockNext,
          on: mockOn,
          destroy: mockDestroy,
        },
      },
    ]);

    const { unmount } = render(<Gallery images={images} autoplayDelay={1000} />);

    expect(screen.getAllByRole('img')).toHaveLength(images.length);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockNext).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
