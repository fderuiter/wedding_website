import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Skeleton } from '../Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';

jest.mock('@/hooks/useReducedMotion');

const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>;

describe('Skeleton', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  test('Skeleton renders without crashing', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<Skeleton ref={ref} className="custom-skeleton-class" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(container.firstChild).toHaveClass('custom-skeleton-class');
    expect(container.firstChild).toHaveClass('animate-pulse');
  });

  test('applies default accessibility ARIA attributes', () => {
    render(<Skeleton />);
    const skeleton = screen.getByRole('status');

    expect(skeleton).toHaveAttribute('role', 'status');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton).toHaveAttribute('aria-live', 'polite');
    expect(skeleton).toHaveAttribute('aria-label', 'Loading...');
  });

  test('allows overriding ARIA attributes and role', () => {
    render(
      <Skeleton
        role="progressbar"
        aria-busy={false}
        aria-live="assertive"
        aria-label="Loading profile content"
      />
    );
    const skeleton = screen.getByRole('progressbar');

    expect(skeleton).toHaveAttribute('role', 'progressbar');
    expect(skeleton).toHaveAttribute('aria-busy', 'false');
    expect(skeleton).toHaveAttribute('aria-live', 'assertive');
    expect(skeleton).toHaveAttribute('aria-label', 'Loading profile content');
  });

  test('disables pulse animation when reduced motion is requested', () => {
    mockUseReducedMotion.mockReturnValue(true);
    render(<Skeleton />);
    const skeleton = screen.getByRole('status');

    expect(skeleton).not.toHaveClass('animate-pulse');
    expect(skeleton).toHaveClass('motion-reduce:animate-none');
  });

  test('includes focus indicator styles and manages tabIndex when interactive', () => {
    render(<Skeleton isInteractive tabIndex={0} />);
    const skeleton = screen.getByRole('status');

    expect(skeleton).toHaveAttribute('tabindex', '0');
    expect(skeleton).toHaveClass('focus-visible:ring-2');
  });

  test('handles keyboard events and fires onClick when Enter or Space is pressed on interactive skeleton', () => {
    const handleClick = jest.fn();
    const handleKeyDown = jest.fn();

    render(
      <Skeleton
        isInteractive
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      />
    );
    const skeleton = screen.getByRole('status');

    fireEvent.keyDown(skeleton, { key: 'ArrowDown' });
    expect(handleKeyDown).toHaveBeenCalledTimes(1);
    expect(handleClick).not.toHaveBeenCalled();

    fireEvent.keyDown(skeleton, { key: 'Enter' });
    expect(handleClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(skeleton, { key: ' ' });
    expect(handleClick).toHaveBeenCalledTimes(2);
  });
});


