import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Icon } from '../Icon';

describe('Icon', () => {
  test('Icon renders without crashing', () => {
    render(<Icon name="X" />);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<SVGSVGElement>();
    const { container } = render(<Icon ref={ref} name="X" className="custom-icon-class text-red-500" />);

    expect(ref.current).toBeInstanceOf(SVGSVGElement);
    expect(container.firstChild).toHaveClass('custom-icon-class');
    expect(container.firstChild).toHaveClass('text-red-500');
  });
});

