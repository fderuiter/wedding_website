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

test('FormMessage renders persistent live region container when empty', () => {
  render(
    <FormGroup>
      <FormMessage data-testid="empty-message" />
    </FormGroup>
  );
  const msg = screen.getByTestId('empty-message');
  expect(msg).toBeInTheDocument();
  expect(msg.tagName).toBe('P');
  expect(msg).toHaveClass('sr-only');
  expect(msg).not.toHaveClass('mt-1');
  expect(msg).toHaveAttribute('role', 'status');
  expect(msg).toHaveAttribute('aria-live', 'polite');
  expect(msg).toHaveAttribute('aria-atomic', 'true');
  expect(msg.textContent).toBe('');
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
  const emptyMessage = screen.getByTestId('my-message');
  expect(emptyMessage).toBeInTheDocument();
  expect(emptyMessage).toHaveClass('sr-only');
  expect(emptyMessage.textContent).toBe('');

  // Re-set message
  fireEvent.click(btnSet);
  expect(input).toHaveAttribute('aria-describedby');
  const newMessage = screen.getByTestId('my-message');
  expect(input.getAttribute('aria-describedby')).toBe(newMessage.id);
  expect(newMessage).toHaveClass('mt-1');
  expect(newMessage.textContent).toBe('Updated message');
});

test('FormMessage sets correct ARIA role and aria-live based on FormGroup state and prop overrides', () => {
  const { rerender } = render(
    <FormGroup state="error">
      <FormMessage data-testid="msg">Error message</FormMessage>
    </FormGroup>
  );
  let msg = screen.getByTestId('msg');
  expect(msg).toHaveAttribute('role', 'alert');
  expect(msg).toHaveAttribute('aria-live', 'assertive');
  expect(msg).toHaveAttribute('aria-atomic', 'true');

  rerender(
    <FormGroup state="default">
      <FormMessage data-testid="msg">Default message</FormMessage>
    </FormGroup>
  );
  msg = screen.getByTestId('msg');
  expect(msg).toHaveAttribute('role', 'status');
  expect(msg).toHaveAttribute('aria-live', 'polite');

  rerender(
    <FormGroup state="success">
      <FormMessage data-testid="msg">Success message</FormMessage>
    </FormGroup>
  );
  msg = screen.getByTestId('msg');
  expect(msg).toHaveAttribute('role', 'status');
  expect(msg).toHaveAttribute('aria-live', 'polite');

  rerender(
    <FormGroup state="warning">
      <FormMessage data-testid="msg">Warning message</FormMessage>
    </FormGroup>
  );
  msg = screen.getByTestId('msg');
  expect(msg).toHaveAttribute('role', 'status');
  expect(msg).toHaveAttribute('aria-live', 'polite');

  // Custom prop overrides
  rerender(
    <FormGroup state="default">
      <FormMessage data-testid="msg" role="alert" aria-live="assertive">
        Custom message
      </FormMessage>
    </FormGroup>
  );
  msg = screen.getByTestId('msg');
  expect(msg).toHaveAttribute('role', 'alert');
  expect(msg).toHaveAttribute('aria-live', 'assertive');
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

test('Form components apply CSS custom properties for default and feedback states', () => {
  const { rerender } = render(
    <FormGroup state="default">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <Textarea data-testid="textarea" />
      <Select data-testid="select" />
      <Checkbox data-testid="checkbox" />
      <FormMessage data-testid="message">Default message</FormMessage>
    </FormGroup>
  );

  const label = screen.getByTestId('label');
  const input = screen.getByTestId('input');
  const textarea = screen.getByTestId('textarea');
  const select = screen.getByTestId('select');
  const checkbox = screen.getByTestId('checkbox');
  const message = screen.getByTestId('message');

  expect(label.className).toContain('text-[var(--form-label-text,var(--color-primary-text,#111827))]');
  expect(input.className).toContain('border-[var(--input-border,var(--color-surface-border,#d1d5db))]');
  expect(input.className).toContain('bg-[var(--input-bg,#ffffff)]');
  expect(input.style.borderRadius).toBe('var(--input-radius, 0.375rem)');
  expect(textarea.className).toContain('border-[var(--input-border,var(--color-surface-border,#d1d5db))]');
  expect(select.className).toContain('border-[var(--input-border,var(--color-surface-border,#d1d5db))]');
  expect(checkbox.className).toContain('border-[var(--input-border,var(--color-surface-border,#d1d5db))]');
  expect(message.className).toContain('text-[var(--form-message-text,var(--color-secondary-text,#6b7280))]');

  // Rerender with error state
  rerender(
    <FormGroup state="error">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Error message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-error-text,var(--color-error-text,#dc2626))]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-error-border,var(--color-error-text,#ef4444))]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-error-text,var(--color-error-text,#dc2626))]');

  // Rerender with success state
  rerender(
    <FormGroup state="success">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Success message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-success-text,#16a34a)]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-success-border,#22c55e)]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-success-text,#16a34a)]');

  // Rerender with warning state
  rerender(
    <FormGroup state="warning">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Warning message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-warning-text,#ca8a04)]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-warning-border,#f59e0b)]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-warning-text,#ca8a04)]');
});
