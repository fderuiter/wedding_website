import React from 'react';
import { render, screen } from '@testing-library/react';
import RegistryItemProgressBar from '../RegistryItemProgressBar';

describe('RegistryItemProgressBar', () => {
  it('renders with correct width and ARIA attributes', () => {
    render(<RegistryItemProgressBar contributed={50} total={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('caps progress at 100%', () => {
    render(<RegistryItemProgressBar contributed={150} total={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows 0% if total is 0', () => {
    render(<RegistryItemProgressBar contributed={0} total={0} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });
});
