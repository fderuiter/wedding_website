import React from 'react';
import { render, screen } from '@testing-library/react';
import RegistryItemProgressBar from '../RegistryItemProgressBar';
import { useReducedMotion } from '@/hooks/useReducedMotion';

jest.mock('@/hooks/useReducedMotion');
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, transition, className, initial, animate }: any) => (
      <div
        className={className}
        data-testid="motion-bar"
        data-transition={JSON.stringify(transition)}
      >
        {children}
      </div>
    ),
  },
}));

const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>;

describe('RegistryItemProgressBar', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders with correct width and ARIA attributes including formatted aria-valuetext', () => {
    render(<RegistryItemProgressBar contributed={50} total={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '$50.00 of $100.00 funded (50%)');
  });

  it('rounds aria-valuenow to an integer and formats aria-valuetext correctly for non-integer percentages', () => {
    render(<RegistryItemProgressBar contributed={2} total={3} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
    expect(bar).toHaveAttribute('aria-valuetext', '$2.00 of $3.00 funded (67%)');
  });

  it('caps progress at 100%', () => {
    render(<RegistryItemProgressBar contributed={150} total={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '$150.00 of $100.00 funded (100%)');
  });

  it('shows 0% if total is 0', () => {
    render(<RegistryItemProgressBar contributed={0} total={0} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuetext', '$0.00 of $0.00 funded (0%)');
  });

  it('uses standard transition duration when reduced motion is not preferred', () => {
    mockUseReducedMotion.mockReturnValue(false);
    render(<RegistryItemProgressBar contributed={50} total={100} />);
    const motionBar = screen.getByTestId('motion-bar');
    expect(motionBar).toHaveAttribute('data-transition', JSON.stringify({ duration: 0.8, ease: 'easeInOut' }));
  });

  it('disables animation duration when reduced motion is preferred', () => {
    mockUseReducedMotion.mockReturnValue(true);
    render(<RegistryItemProgressBar contributed={50} total={100} />);
    const motionBar = screen.getByTestId('motion-bar');
    expect(motionBar).toHaveAttribute('data-transition', JSON.stringify({ duration: 0, ease: 'easeInOut' }));
  });
});
