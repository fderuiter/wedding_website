import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Button, getButtonClassName, type ButtonProps } from '../Button';

expect.extend(toHaveNoViolations);

describe('Button', () => {
  test('Button renders without crashing', () => {
    render(<Button>Click me</Button>);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLButtonElement>();
    const { container } = render(<Button ref={ref} className="custom-button-class">Click me</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(container.firstChild).toHaveClass('custom-button-class');
    expect(container.firstChild).toHaveClass('inline-flex');
  });

  test('applies CSS variable class bindings for outline, ghost, and inverse variants', () => {
    const { getByRole, rerender } = render(<Button variant="outline">Outline Button</Button>);
    let button = getByRole('button');
    expect(button).toHaveClass('bg-[var(--btn-outline-bg,transparent)]');
    expect(button).toHaveClass('border-[var(--btn-outline-border,var(--color-surface-border,#6b7280))]');

    rerender(<Button variant="ghost">Ghost Button</Button>);
    button = getByRole('button');
    expect(button).toHaveClass('bg-[var(--btn-ghost-bg,transparent)]');
    expect(button).toHaveClass('hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]');

    const linkClasses = getButtonClassName({ variant: 'inverse', size: 'sm' });
    expect(linkClasses).toContain('bg-[var(--toast-action-bg,#ffffff)]');
    expect(linkClasses).toContain('text-[var(--toast-action-text,#111827)]');
    expect(linkClasses).toContain('h-8 px-3 text-xs');
  });

  test('applies disabled cursor styling without disabling pointer events', () => {
    const { getByRole } = render(<Button disabled>Disabled Button</Button>);
    const button = getByRole('button');

    expect(button).toHaveClass('disabled:cursor-not-allowed');
    expect(button).not.toHaveClass('disabled:pointer-events-none');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeDisabled();
  });

  test('handles aria-disabled prop correctly', () => {
    const { getByRole } = render(<Button aria-disabled={true}>Aria Disabled Button</Button>);
    const button = getByRole('button');

    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('aria-disabled:cursor-not-allowed');
  });

  test('prevents click and keyboard activation when disabled or aria-disabled', () => {
    const handleClick = jest.fn();
    const handleKeyDown = jest.fn();

    const { getByRole, rerender } = render(
      <Button disabled onClick={handleClick} onKeyDown={handleKeyDown}>
        Disabled
      </Button>
    );

    const button = getByRole('button');
    button.click();
    expect(handleClick).not.toHaveBeenCalled();

    rerender(
      <Button aria-disabled={true} onClick={handleClick} onKeyDown={handleKeyDown}>
        Aria Disabled
      </Button>
    );

    button.click();
    expect(handleClick).not.toHaveBeenCalled();
  });

  test('supports pressed and srContext props with visible-first accessible name and passes jest-axe', async () => {
    const toggleProps: ButtonProps = {
      variant: 'outline',
      pressed: true,
      srContext: 'for Our Story',
    };
    const { container, getByRole, rerender } = render(
      <Button {...toggleProps}>Visible</Button>
    );

    let button = getByRole('button', { name: 'Visible for Our Story' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('ring-2');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(button.querySelector('.sr-only')?.textContent).toBe(' for Our Story');

    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    rerender(
      <Button variant="ghost" pressed={false} srContext="for Our Story">
        Hidden
      </Button>
    );
    button = getByRole('button', { name: 'Hidden for Our Story' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveClass('ring-current');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeNull();
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    rerender(<Button>Standard Action</Button>);
    button = getByRole('button', { name: 'Standard Action' });
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button.querySelector('.sr-only')).toBeNull();

    rerender(
      <Button aria-label="Close modal">
        <span aria-hidden="true">×</span>
      </Button>
    );
    expect(getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();
  });

  test('supports inverse variant with opaque toast action tokens, two-tone focus ring, and forced-colors outline', async () => {
    const { container, getByRole } = render(<Button variant="inverse">Undo</Button>);
    const button = getByRole('button', { name: 'Undo' });

    expect(button).toHaveClass('bg-[var(--toast-action-bg,#ffffff)]');
    expect(button).toHaveClass('text-[var(--toast-action-text,#111827)]');
    expect(button).toHaveClass('hover:bg-[var(--toast-action-hover-bg,#e5e7eb)]');
    expect(button).toHaveClass('focus-visible:ring-[var(--toast-action-bg,#ffffff)]');
    expect(button).toHaveClass('focus-visible:ring-offset-[var(--toast-action-text,#111827)]');
    expect(button).toHaveClass('forced-colors:border');
    expect(await axe(container)).toHaveNoViolations();
  });

  test('supports calibrated success and secondary variants with forced-colors outlines and passes jest-axe', async () => {
    const { container, getByRole, rerender } = render(
      <Button variant="success" data-testid="approve-btn">
        Approve
      </Button>
    );
    let button = getByRole('button', { name: 'Approve' });

    expect(button).toHaveAttribute('data-testid', 'approve-btn');
    expect(button).toHaveClass('bg-[var(--btn-success-bg,#15803d)]');
    expect(button).toHaveClass('text-[var(--btn-success-text,#ffffff)]');
    expect(button).toHaveClass('hover:bg-[var(--btn-success-hover-bg,#166534)]');
    expect(button).toHaveClass('border-[var(--btn-success-border,transparent)]');
    expect(button).toHaveClass('forced-colors:border');
    expect(button).toHaveClass('forced-colors:border-[ButtonText]');
    expect(await axe(container)).toHaveNoViolations();

    rerender(<Button variant="secondary">Import Items</Button>);
    button = getByRole('button', { name: 'Import Items' });
    expect(button).toHaveClass('bg-[var(--btn-secondary-bg,var(--color-secondary,#B45309))]');
    expect(button).toHaveClass('text-[var(--btn-secondary-text,#ffffff)]');
    expect(button).toHaveClass('forced-colors:border');
    expect(button).toHaveClass('forced-colors:border-[ButtonText]');
    expect(await axe(container)).toHaveNoViolations();
  });
});

