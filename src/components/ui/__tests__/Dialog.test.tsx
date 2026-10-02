import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dialog } from '../Dialog';

describe('Dialog', () => {
  test('Dialog renders without crashing', () => {
    render(<Dialog isOpen={true} onClose={() => {}}>Content</Dialog>);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog ref={ref} isOpen={true} onClose={() => {}} className="custom-dialog-class">
        Content
      </Dialog>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dialog-class');
    expect(ref.current).toHaveClass('bg-white');
  });
});

