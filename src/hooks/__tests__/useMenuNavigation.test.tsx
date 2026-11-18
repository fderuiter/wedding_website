import React, { useRef } from 'react';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useMenuNavigation } from '../useMenuNavigation';

interface TestMenuProps {
  items?: Array<{ label: string; disabled?: boolean }>;
}

function TestMenu({
  items = [{ label: 'First' }, { label: 'Second' }, { label: 'Third' }],
}: TestMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { handleMenuKeyDown } = useMenuNavigation(containerRef);

  return (
    <div ref={containerRef} role="menu" data-testid="menu-container" onKeyDown={handleMenuKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

describe('useMenuNavigation', () => {
  it('moves focus forward with ArrowDown and wraps from last item to first', () => {
    render(<TestMenu />);
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
  });

  it('moves focus backward with ArrowUp and wraps from first item to last', () => {
    render(<TestMenu />);
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('navigates to first and last items with Home and End keys', () => {
    render(<TestMenu />);
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    second.focus();
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'End' });
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('targets the first menu item when navigation keys are pressed while no menu item has focus', () => {
    render(<TestMenu />);
    const container = screen.getByTestId('menu-container');
    const first = screen.getByRole('menuitem', { name: 'First' });

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);

    first.blur();
    fireEvent.keyDown(container, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    first.blur();
    fireEvent.keyDown(container, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('returns early without runtime exceptions when the menu list is empty or ref is null', () => {
    render(<TestMenu items={[]} />);
    const container = screen.getByTestId('menu-container');

    expect(() => {
      fireEvent.keyDown(container, { key: 'ArrowDown' });
      fireEvent.keyDown(container, { key: 'ArrowUp' });
      fireEvent.keyDown(container, { key: 'Home' });
      fireEvent.keyDown(container, { key: 'End' });
    }).not.toThrow();

    const nullRef = { current: null as HTMLDivElement | null };
    const { result } = renderHook(() => useMenuNavigation(nullRef));
    const preventDefault = jest.fn();

    expect(() => {
      result.current.handleMenuKeyDown({
        key: 'ArrowDown',
        preventDefault,
      } as unknown as React.KeyboardEvent);
    }).not.toThrow();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('skips disabled menu items and ignores non-navigation keys', () => {
    render(
      <TestMenu
        items={[
          { label: 'First' },
          { label: 'Disabled', disabled: true },
          { label: 'Third' },
        ]}
      />
    );
    const first = screen.getByRole('menuitem', { name: 'First' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);

    const enterAllowed = fireEvent.keyDown(third, { key: 'Enter' });
    expect(enterAllowed).toBe(true);
    expect(document.activeElement).toBe(third);
  });
});
