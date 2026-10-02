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
});

