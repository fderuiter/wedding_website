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

  test('does not default to dialog role or aria-modal', () => {
    const { queryAllByRole, container } = render(
      <Overlay isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Overlay>
    );

    expect(queryAllByRole('dialog')).toHaveLength(0);
    const outerElement = container.firstChild as HTMLElement;
    expect(outerElement).not.toHaveAttribute('role');
    expect(outerElement).not.toHaveAttribute('aria-modal');
  });

  test('correctly forwards optional role and aria-modal props when provided', () => {
    const { getByRole } = render(
      <Overlay isOpen={true} onClose={() => {}} role="region" aria-modal="true">
        <div>Content</div>
      </Overlay>
    );

    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-modal', 'true');
  });

  test('renders standalone dialog role without duplicate dialog roles', () => {
    const { getAllByRole } = render(
      <Overlay isOpen={true} onClose={() => {}} role="dialog" aria-modal="true">
        <div>Content</div>
      </Overlay>
    );

    const dialogs = getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
  });
});

