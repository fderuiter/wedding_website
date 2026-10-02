import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Skeleton } from '../Skeleton';

describe('Skeleton', () => {
  test('Skeleton renders without crashing', () => {
    render(<Skeleton />);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<Skeleton ref={ref} className="custom-skeleton-class" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(container.firstChild).toHaveClass('custom-skeleton-class');
    expect(container.firstChild).toHaveClass('animate-pulse');
  });
});

