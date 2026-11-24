import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import EmptyState from '../EmptyState';

expect.extend(toHaveNoViolations);

describe('EmptyState', () => {
  it('omits status live-region attributes by default so initial empty states remain silent', async () => {
    const { container } = render(
      <EmptyState message="No gifts have been added yet." actionLabel="Refresh" onAction={jest.fn()} />
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).toBeNull();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('attaches polite role="status" semantics when opted in for dynamic filter empty states', async () => {
    const { container } = render(
      <EmptyState
        role="status"
        message="No gifts match the current filters."
        actionLabel="Clear Filters"
        onAction={jest.fn()}
      />
    );

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveTextContent('No gifts match the current filters.');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
