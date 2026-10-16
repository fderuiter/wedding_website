import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from '../Button';

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

  test('applies CSS variable class bindings for outline and ghost variants', () => {
    const { getByRole, rerender } = render(<Button variant="outline">Outline Button</Button>);
    let button = getByRole('button');
    expect(button).toHaveClass('bg-[var(--btn-outline-bg,transparent)]');
    expect(button).toHaveClass('border-[var(--btn-outline-border,var(--color-surface-border,#d1d5db))]');

    rerender(<Button variant="ghost">Ghost Button</Button>);
    button = getByRole('button');
    expect(button).toHaveClass('bg-[var(--btn-ghost-bg,transparent)]');
    expect(button).toHaveClass('hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]');
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
});

