import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Overlay } from '../Overlay';

describe('Overlay', () => {
  test('Overlay renders without crashing', () => {
    render(<Overlay isOpen={true} onClose={() => {}}>Content</Overlay>);
  });

  test('forwards ref to inner panel and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Overlay ref={ref} isOpen={true} onClose={() => {}} className="custom-overlay-content">
        <div>Content</div>
      </Overlay>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-overlay-content');
  });
});

