import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormGroup, Label, Input, Checkbox, Textarea, Select, FormMessage } from '../forms';

test('Form components render without crashing', () => {
  render(
    <FormGroup>
      <Label>Label</Label>
      <Input />
    </FormGroup>
  );
});

test('Checkbox and Label are correctly linked via context id and htmlFor', () => {
  render(
    <FormGroup>
      <Checkbox data-testid="my-checkbox" />
      <Label>Toggle Checkbox</Label>
    </FormGroup>
  );

  const checkbox = screen.getByTestId('my-checkbox') as HTMLInputElement;
  const label = screen.getByText('Toggle Checkbox') as HTMLLabelElement;

  expect(checkbox.id).toBeTruthy();
  expect(label.htmlFor).toBe(checkbox.id);
});

test('FormMessage returns null when it has no children', () => {
  const { container } = render(
    <FormGroup>
      <FormMessage />
    </FormGroup>
  );
  expect(container.firstChild?.childNodes.length).toBe(0);
});

test('Form controls omit aria-describedby unless FormMessage is present and active', () => {
  const { rerender } = render(
    <FormGroup>
      <Input data-testid="my-input" />
      <Textarea data-testid="my-textarea" />
      <Select data-testid="my-select" />
      <Checkbox data-testid="my-checkbox" />
    </FormGroup>
  );

  const input = screen.getByTestId('my-input');
  const textarea = screen.getByTestId('my-textarea');
  const select = screen.getByTestId('my-select');
  const checkbox = screen.getByTestId('my-checkbox');

  expect(input).not.toHaveAttribute('aria-describedby');
  expect(textarea).not.toHaveAttribute('aria-describedby');
  expect(select).not.toHaveAttribute('aria-describedby');
  expect(checkbox).not.toHaveAttribute('aria-describedby');

  rerender(
    <FormGroup>
      <Input data-testid="my-input" />
      <Textarea data-testid="my-textarea" />
      <Select data-testid="my-select" />
      <Checkbox data-testid="my-checkbox" />
      <FormMessage>Error found</FormMessage>
    </FormGroup>
  );

  expect(input).toHaveAttribute('aria-describedby');
  expect(textarea).toHaveAttribute('aria-describedby');
  expect(select).toHaveAttribute('aria-describedby');
  expect(checkbox).toHaveAttribute('aria-describedby');

  expect(input.getAttribute('aria-describedby')).toBe(textarea.getAttribute('aria-describedby'));
});

test('Dynamic transition of FormMessage content from active to empty and vice versa', () => {
  const DynamicFormTest = () => {
    const [message, setMessage] = useState<string | undefined>('Initial message');
    return (
      <FormGroup>
        <Input data-testid="my-input" />
        <FormMessage data-testid="my-message">{message}</FormMessage>
        <button onClick={() => setMessage(undefined)} data-testid="btn-clear">Clear</button>
        <button onClick={() => setMessage('Updated message')} data-testid="btn-set">Set</button>
      </FormGroup>
    );
  };

  render(<DynamicFormTest />);

  const input = screen.getByTestId('my-input');
  const message = screen.getByTestId('my-message');
  const btnClear = screen.getByTestId('btn-clear');
  const btnSet = screen.getByTestId('btn-set');

  // Initially active
  expect(input).toHaveAttribute('aria-describedby', message.id);
  expect(message).toBeInTheDocument();

  // Clear message
  fireEvent.click(btnClear);
  expect(input).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByTestId('my-message')).not.toBeInTheDocument();

  // Re-set message
  fireEvent.click(btnSet);
  expect(input).toHaveAttribute('aria-describedby');
  const newMessage = screen.getByTestId('my-message');
  expect(input.getAttribute('aria-describedby')).toBe(newMessage.id);
});

test('Dynamic transition of FormMessage unmounting and mounting', () => {
  const DynamicMountTest = () => {
    const [mounted, setMounted] = useState(true);
    return (
      <FormGroup>
        <Input data-testid="my-input" />
        {mounted && <FormMessage data-testid="my-message">Warning</FormMessage>}
        <button onClick={() => setMounted(false)} data-testid="btn-unmount">Unmount</button>
        <button onClick={() => setMounted(true)} data-testid="btn-mount">Mount</button>
      </FormGroup>
    );
  };

  render(<DynamicMountTest />);

  const input = screen.getByTestId('my-input');
  const btnUnmount = screen.getByTestId('btn-unmount');
  const btnMount = screen.getByTestId('btn-mount');

  expect(input).toHaveAttribute('aria-describedby');

  // Unmount
  fireEvent.click(btnUnmount);
  expect(input).not.toHaveAttribute('aria-describedby');

  // Mount again
  fireEvent.click(btnMount);
  expect(input).toHaveAttribute('aria-describedby');
});
