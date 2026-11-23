import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useOverlay } from '../useOverlay';

function ToggleDropdownFixture({ excludeTrigger = true }: { excludeTrigger?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { overlayRef } = useOverlay(
    isOpen,
    () => setIsOpen(false),
    excludeTrigger ? { triggerRef } : undefined
  );

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>Toggle Menu</span>
      </button>
      {isOpen && (
        <div ref={overlayRef} role="menu">
          <button type="button" role="menuitem">
            First Action
          </button>
          <button type="button" role="menuitem">
            Second Action
          </button>
        </div>
      )}
    </div>
  );
}

describe('useOverlay', () => {
  it('closes cleanly on first pointer click (mousedown + mouseup + click) when triggerRef is provided', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    const triggerLabel = screen.getByText('Toggle Menu');

    // Open via pointer sequence
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click open trigger (including nested child target) -> closes cleanly without reopening
    fireEvent.mouseDown(triggerLabel);
    fireEvent.mouseUp(triggerLabel);
    fireEvent.click(triggerLabel);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('still dismisses on outside mousedown when clicking outside both overlayRef and triggerRef', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab focus within overlayRef and closes on Escape', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole('menuitem', { name: 'First Action' });
    const second = screen.getByRole('menuitem', { name: 'Second Action' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(second).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
