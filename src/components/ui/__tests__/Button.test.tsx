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
    expect(button).toHaveClass('border-[var(--btn-outline-border,var(--color-border))]');

    rerender(<Button variant="ghost">Ghost Button</Button>);
    button = getByRole('button');
    expect(button).toHaveClass('bg-[var(--btn-ghost-bg,transparent)]');
    expect(button).toHaveClass('hover:bg-[var(--btn-ghost-hover-bg,var(--color-muted))]');
  });
});

