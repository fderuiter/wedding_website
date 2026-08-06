import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Interactive3DCard } from '../Interactive3DCard';

test('Interactive3DCard renders without crashing', () => {
  render(<Interactive3DCard>Content</Interactive3DCard>);
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
