import React, { act } from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import { Interactive3DCard } from '../Interactive3DCard';

test('Interactive3DCard renders without crashing', () => {
  render(<Interactive3DCard>Content</Interactive3DCard>);
});

test('Interactive3DCard forwards DOM ref and merges custom className via cn()', () => {
  const ref = React.createRef<HTMLDivElement>();
  const { container } = render(
    <Interactive3DCard ref={ref} className="custom-card-class">
      Content
    </Interactive3DCard>
  );

  expect(ref.current).toBeInstanceOf(HTMLElement);
  expect(container.firstChild).toHaveClass('custom-card-class');
});

test('Interactive3DCard preserves DOM tree continuity and does not unmount/remount on re-render', () => {

  const { container, rerender } = render(
    <Interactive3DCard className="test-card">
      <input defaultValue="initial-value" data-testid="test-input" />
    </Interactive3DCard>
  );

  const initialElement = container.querySelector('.test-card');
  expect(initialElement).toBeInTheDocument();

  const input = container.querySelector('[data-testid="test-input"]') as HTMLInputElement;
  expect(input.value).toBe('initial-value');

  // Mutate input state to prove it doesn't get wiped out by a dynamic recreation of the parent wrapper
  input.value = 'changed-value';

  rerender(
    <Interactive3DCard className="test-card updated-class">
      <input defaultValue="initial-value" data-testid="test-input" />
    </Interactive3DCard>
  );

  const updatedElement = container.querySelector('.test-card');
  expect(updatedElement).toBe(initialElement);
  expect(updatedElement).toHaveClass('updated-class');

  const updatedInput = container.querySelector('[data-testid="test-input"]') as HTMLInputElement;
  expect(updatedInput).toBe(input);
  expect(updatedInput.value).toBe('changed-value');
});

test('static Interactive3DCard renders without role, tabIndex, or aria-describedby tilt instructions and passes axe', async () => {
  const { container } = render(
    <Interactive3DCard as="article">
      <h3>Travel Information</h3>
      <p>Shuttle departs at 4:00 PM.</p>
    </Interactive3DCard>
  );

  const card = container.firstChild as HTMLElement;
  expect(card.tagName).toBe('ARTICLE');
  expect(card).not.toHaveAttribute('role');
  expect(card).not.toHaveAttribute('tabIndex');
  expect(card).not.toHaveAttribute('aria-describedby');
  expect(container.querySelector('[aria-live]')).not.toBeInTheDocument();

  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const allowed = fireEvent.keyDown(card, { key });
    expect(allowed).toBe(true);
  }

  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test('Interactive3DCard applies role="button" and tabIndex=0 only when onClick exists without tabIndex=-1', async () => {
  const { container, rerender } = render(
    <Interactive3DCard onClick={jest.fn()}>
      Accessible Card Content
    </Interactive3DCard>
  );

  const card = container.firstChild as HTMLElement;
  expect(card).toHaveAttribute('tabIndex', '0');
  expect(card).toHaveAttribute('role', 'button');
  expect(card).toHaveClass('focus-visible:ring-2');
  expect(card).toHaveClass('focus-visible:ring-primary');
  expect(card).not.toHaveAttribute('aria-describedby');

  const clickableAxe = await axe(container);
  expect(clickableAxe).toHaveNoViolations();

  rerender(
    <Interactive3DCard as="article" onClick={jest.fn()} tabIndex={-1}>
      <h3>Gift Card</h3>
      <button type="button">Contribute</button>
    </Interactive3DCard>
  );

  const containerCard = container.firstChild as HTMLElement;
  expect(containerCard.tagName).toBe('ARTICLE');
  expect(containerCard).toHaveAttribute('tabIndex', '-1');
  expect(containerCard).not.toHaveAttribute('role');

  const containerAxe = await axe(container);
  expect(containerAxe).toHaveNoViolations();
});

test('Interactive3DCard activates onClick on Enter/Space without capturing arrow keys and ignores nested button key events', () => {
  const handleClick = jest.fn();
  const handleNestedClick = jest.fn();
  const handleKeyDown = jest.fn();

  const { container, getByRole } = render(
    <Interactive3DCard onClick={handleClick} onKeyDown={handleKeyDown} tabIndex={0}>
      <span>Keyboard Card</span>
      <button type="button" onClick={handleNestedClick}>
        Inner Action
      </button>
    </Interactive3DCard>
  );

  const card = container.firstChild as HTMLElement;
  const innerButton = getByRole('button', { name: 'Inner Action' });

  // Arrow keys do not call preventDefault()
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    let wasDefaultPrevented = true;
    act(() => {
      wasDefaultPrevented = !fireEvent.keyDown(card, { key });
    });
    expect(wasDefaultPrevented).toBe(false);
  }
  expect(handleKeyDown).toHaveBeenCalledTimes(4);
  expect(handleClick).not.toHaveBeenCalled();

  // Direct Enter and Space on card trigger outer onClick
  act(() => {
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
  });
  expect(handleClick).toHaveBeenCalledTimes(2);

  // Nested button Enter and Space do NOT trigger outer card onClick
  act(() => {
    fireEvent.keyDown(innerButton, { key: 'Enter' });
    fireEvent.keyDown(innerButton, { key: ' ' });
  });
  expect(handleClick).toHaveBeenCalledTimes(2);
});

test('Interactive3DCard disables 3D transform styles when prefers-reduced-motion is active', () => {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  try {
    const { container } = render(
      <Interactive3DCard>
        Reduced Motion Card
      </Interactive3DCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.style.transformStyle).toBe('');
    expect(card.style.willChange).toBe('');
  } finally {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  }
});
