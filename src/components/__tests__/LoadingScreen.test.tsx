import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoadingScreen from '../LoadingScreen';

describe('LoadingScreen', () => {
  it('renders spinner and loading text with correct classes', () => {
    const { container } = render(<LoadingScreen />);

    const spinner = container.querySelector('svg');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('animate-spin', 'h-16', 'w-16', 'text-red-500', 'mb-6');

    const text = screen.getByText('Loading...');
    expect(text).toBeInTheDocument();
    expect(text).toHaveClass('text-xl', 'font-semibold', 'text-red-700', 'dark:text-yellow-300');
  });
});
