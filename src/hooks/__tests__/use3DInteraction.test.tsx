import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { use3DInteraction } from '../use3DInteraction';

describe('use3DInteraction', () => {
  const options = {
    instructions: 'Use arrow keys to navigate in 3D.',
    labels: {
      up: 'Rotated up',
      down: 'Rotated down',
      left: 'Rotated left',
      right: 'Rotated right',
      action: 'Activated object',
    },
    onUp: jest.fn(),
    onDown: jest.fn(),
    onLeft: jest.fn(),
    onRight: jest.fn(),
    onAction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders instructions and live region with proper ARIA attributes', () => {
    const TestComponent = () => {
      const { getInteractiveProps, AccessibleElements } = use3DInteraction(options);
      const props = getInteractiveProps();
      return (
        <div data-testid="interactive" {...props}>
          {AccessibleElements}
        </div>
      );
    };

    const { getByTestId, container } = render(<TestComponent />);
    const interactiveEl = getByTestId('interactive');

    const ariaDescribedBy = interactiveEl.getAttribute('aria-describedby');
    expect(ariaDescribedBy).toMatch(/3d-instructions-/);

    const instructionsEl = container.querySelector(`[id="${ariaDescribedBy}"]`);
    expect(instructionsEl).toBeInTheDocument();
    expect(instructionsEl).toHaveTextContent('Use arrow keys to navigate in 3D.');

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveTextContent('');
  });

  it('announces movement on first arrow press and suppresses repeated live announcements on consecutive keypresses', () => {
    const TestComponent = () => {
      const { getInteractiveProps, AccessibleElements } = use3DInteraction(options);
      const props = getInteractiveProps();
      return (
        <div data-testid="interactive" {...props} tabIndex={0}>
          {AccessibleElements}
        </div>
      );
    };

    const { getByTestId, container } = render(<TestComponent />);
    const interactiveEl = getByTestId('interactive');
    const liveRegion = container.querySelector('[aria-live="polite"]');

    // 1st press ArrowUp -> announces "Rotated up"
    fireEvent.keyDown(interactiveEl, { key: 'ArrowUp' });
    expect(options.onUp).toHaveBeenCalledTimes(1);
    expect(liveRegion).toHaveTextContent('Rotated up');

    // Fast-forward 1.5 seconds (past old 1000ms clear threshold)
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // The live region MUST NOT be cleared back to empty
    expect(liveRegion).toHaveTextContent('Rotated up');

    // 2nd press ArrowUp -> repeats same keypress, announcement state remains "Rotated up" (suppressed duplicate DOM update)
    fireEvent.keyDown(interactiveEl, { key: 'ArrowUp' });
    expect(options.onUp).toHaveBeenCalledTimes(2);
    expect(liveRegion).toHaveTextContent('Rotated up');

    // Press ArrowDown -> direction changes, updates announcement to "Rotated down"
    fireEvent.keyDown(interactiveEl, { key: 'ArrowDown' });
    expect(options.onDown).toHaveBeenCalledTimes(1);
    expect(liveRegion).toHaveTextContent('Rotated down');
  });

  it('handles action trigger via Enter, Space, or Click', () => {
    const TestComponent = () => {
      const { getInteractiveProps, AccessibleElements } = use3DInteraction(options);
      const props = getInteractiveProps();
      return (
        <button data-testid="interactive" {...props}>
          {AccessibleElements}
        </button>
      );
    };

    const { getByTestId, container } = render(<TestComponent />);
    const interactiveEl = getByTestId('interactive');
    const liveRegion = container.querySelector('[aria-live="polite"]');

    fireEvent.keyDown(interactiveEl, { key: 'Enter' });
    expect(options.onAction).toHaveBeenCalledTimes(1);
    expect(liveRegion).toHaveTextContent('Activated object');

    fireEvent.click(interactiveEl);
    expect(options.onAction).toHaveBeenCalledTimes(2);
    expect(liveRegion).toHaveTextContent('Activated object');
  });

  it('preserves existing aria-describedby and forwards original handlers', () => {
    const originalOnClick = jest.fn();
    const originalOnKeyDown = jest.fn();

    const TestComponent = () => {
      const { getInteractiveProps, AccessibleElements } = use3DInteraction(options);
      const props = getInteractiveProps({
        'aria-describedby': 'external-description',
        onClick: originalOnClick,
        onKeyDown: originalOnKeyDown,
      });

      return (
        <div data-testid="interactive" {...props} tabIndex={0}>
          {AccessibleElements}
        </div>
      );
    };

    const { getByTestId } = render(<TestComponent />);
    const interactiveEl = getByTestId('interactive');

    expect(interactiveEl.getAttribute('aria-describedby')).toMatch(/^external-description 3d-instructions-/);

    fireEvent.keyDown(interactiveEl, { key: 'ArrowLeft' });
    expect(options.onLeft).toHaveBeenCalledTimes(1);
    expect(originalOnKeyDown).toHaveBeenCalledTimes(1);

    fireEvent.click(interactiveEl);
    expect(options.onAction).toHaveBeenCalledTimes(1);
    expect(originalOnClick).toHaveBeenCalledTimes(1);
  });
});
