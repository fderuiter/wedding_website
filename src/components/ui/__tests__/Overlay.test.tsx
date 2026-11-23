import React, { useRef, useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Overlay } from '../Overlay';

expect.extend(toHaveNoViolations);

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

  test('passes automated axe accessibility audits when open as a dialog', async () => {
    const { container } = render(
      <Overlay isOpen={true} onClose={() => {}} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">Dialog Title</h2>
        <p>Dialog body content</p>
      </Overlay>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('forwards aria-label (ARIA14) for standalone modal dialogs and passes axe', async () => {
    const { container } = render(
      <Overlay isOpen={true} onClose={() => {}} role="dialog" aria-modal="true" aria-label="Mobile navigation menu">
        <button type="button">Close navigation menu</button>
      </Overlay>
    );

    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation menu' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });

  test('excludes optional triggerRef from outside mousedown so toggle button closes cleanly', async () => {
    function TriggeredOverlayFixture() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);

      return (
        <div>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            Toggle Drawer
          </button>
          <Overlay
            isOpen={open}
            onClose={() => setOpen(false)}
            triggerRef={triggerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Test Drawer"
          >
            <button type="button" onClick={() => setOpen(false)}>
              Close Drawer
            </button>
          </Overlay>
        </div>
      );
    }

    render(<TriggeredOverlayFixture />);
    const trigger = screen.getByRole('button', { name: 'Toggle Drawer' });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Test Drawer' })).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

