import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccessibleStep } from '../AccessibleStep';

describe('AccessibleStep', () => {
  test('AccessibleStep renders without crashing', () => {
    render(<AccessibleStep isActive={true}>Content</AccessibleStep>);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(
      <AccessibleStep ref={ref} isActive={true} className="custom-step-class">
        Content
      </AccessibleStep>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(container.firstChild).toHaveClass('custom-step-class');
    expect(container.firstChild).toHaveClass('outline-none');
  });
});

