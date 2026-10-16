import React, { act } from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
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

test('Interactive3DCard applies focus visible classes, tabIndex, and ARIA roles', () => {
  const { container } = render(
    <Interactive3DCard onClick={jest.fn()}>
      Accessible Card Content
    </Interactive3DCard>
  );

  const card = container.firstChild as HTMLElement;
  expect(card).toHaveAttribute('tabIndex', '0');
  expect(card).toHaveAttribute('role', 'button');
  expect(card).toHaveClass('focus-visible:ring-2');
  expect(card).toHaveClass('focus-visible:ring-primary');
  expect(card).toHaveAttribute('aria-describedby');
});

test('Interactive3DCard handles keyboard controls and triggers onClick on Enter/Space', () => {
  const handleClick = jest.fn();
  const handleKeyDown = jest.fn();

  const { container } = render(
    <Interactive3DCard onClick={handleClick} onKeyDown={handleKeyDown}>
      Keyboard Card
    </Interactive3DCard>
  );

  const card = container.firstChild as HTMLElement;

  // Arrow navigation
  act(() => {
    fireEvent.keyDown(card, { key: 'ArrowUp' });
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    fireEvent.keyDown(card, { key: 'ArrowLeft' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
  });

  expect(handleKeyDown).toHaveBeenCalledTimes(4);

  // Action key triggers click
  act(() => {
    fireEvent.keyDown(card, { key: 'Enter' });
  });
  expect(handleClick).toHaveBeenCalledTimes(1);
});
