import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  StatusBadge,
  getStatusBadgeClassName,
  type StatusBadgeTone,
  type StatusBadgeVariant,
  type StatusBadgeSize,
} from '../StatusBadge';

expect.extend(toHaveNoViolations);

describe('StatusBadge', () => {
  const tones: StatusBadgeTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];
  const variants: StatusBadgeVariant[] = ['subtle', 'solid'];
  const sizes: StatusBadgeSize[] = ['xs', 'sm', 'md'];

  test('renders default neutral subtle badge with forced-colors outline', () => {
    render(<StatusBadge data-testid="default-badge">Pending</StatusBadge>);
    const badge = screen.getByTestId('default-badge');

    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveTextContent('Pending');
    expect(badge).toHaveClass('inline-flex', 'items-center', 'border');
    expect(badge).toHaveClass('forced-colors:border', 'forced-colors:border-[CanvasText]');
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLSpanElement>();
    render(
      <StatusBadge ref={ref} tone="success" variant="solid" className="uppercase shadow">
        In Gallery
      </StatusBadge>
    );

    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current).toHaveClass('uppercase', 'shadow');
    expect(ref.current).toHaveClass('bg-[var(--btn-success-bg,#15803d)]');
    expect(ref.current).toHaveClass('text-[var(--btn-success-text,#ffffff)]');
  });

  test('applies calibrated tokens across all tones, variants, and sizes with zero jest-axe violations', async () => {
    const { container } = render(
      <div>
        {variants.map((variant) =>
          tones.map((tone) =>
            sizes.map((size) => (
              <StatusBadge
                key={`${variant}-${tone}-${size}`}
                variant={variant}
                tone={tone}
                size={size}
                data-testid={`badge-${variant}-${tone}-${size}`}
              >
                {`${variant} ${tone} ${size}`}
              </StatusBadge>
            ))
          )
        )}
      </div>
    );

    expect(screen.getByTestId('badge-solid-success-xs')).toHaveClass(
      'bg-[var(--btn-success-bg,#15803d)]',
      'text-[var(--btn-success-text,#ffffff)]',
      'forced-colors:border-[CanvasText]'
    );
    expect(screen.getByTestId('badge-subtle-success-sm')).toHaveClass(
      'text-status-success-text',
      'forced-colors:border-[CanvasText]'
    );
    expect(screen.getByTestId('badge-subtle-warning-md')).toHaveClass(
      'text-status-warning-text',
      'px-3',
      'py-1'
    );
    expect(getStatusBadgeClassName({ tone: 'danger', variant: 'solid' })).toContain(
      'bg-[var(--btn-danger-bg,#b91c1c)]'
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
