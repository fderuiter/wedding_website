import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMenuPopup } from '../useMenuPopup';

function MenuPopupHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef } = useMenuPopup(isOpen, () => setIsOpen(false), { triggerRef });

  return (
    <div>
      <button type="button">Before Trigger</button>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'harness-popup-menu' : undefined}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        Open Menu
      </button>
      {isOpen && (
        <div id="harness-popup-menu" ref={menuRef} role="menu">
          <button type="button" role="menuitem">
            First Item
          </button>
          <button type="button" role="menuitem">
            Second Item
          </button>
        </div>
      )}
      <button type="button">After Trigger</button>
    </div>
  );
}

describe('useMenuPopup', () => {
  test('omits aria-controls when closed, focuses first menuitem on open, and closes on Escape restoring trigger focus', () => {
    render(<MenuPopupHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Menu' });

    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-controls', 'harness-popup-menu');
    expect(screen.getByRole('menuitem', { name: 'First Item' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-controls');
    expect(trigger).toHaveFocus();
  });

  test('closes menu on Tab without trapping and advances focus sequentially to next page control', () => {
    render(<MenuPopupHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Menu' });
    const afterBtn = screen.getByRole('button', { name: 'After Trigger' });

    fireEvent.click(trigger);
    const firstItem = screen.getByRole('menuitem', { name: 'First Item' });
    expect(firstItem).toHaveFocus();

    fireEvent.keyDown(firstItem, { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(afterBtn).toHaveFocus();
  });

  test('closes menu on Shift+Tab and returns focus to trigger button', () => {
    render(<MenuPopupHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Menu' });

    fireEvent.click(trigger);
    const firstItem = screen.getByRole('menuitem', { name: 'First Item' });
    expect(firstItem).toHaveFocus();

    fireEvent.keyDown(firstItem, { key: 'Tab', shiftKey: true });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('closes on outside background mousedown restoring trigger focus, and toggles cleanly on trigger click', () => {
    render(<MenuPopupHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Menu' });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // Reopen and click trigger directly (mousedown + mouseup + click)
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
