import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FormGroup, Label, Input, Checkbox, Textarea, Select, FormMessage } from '../forms';

expect.extend(toHaveNoViolations);

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
  expect(input.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(input.className).toContain('bg-[var(--input-bg,#ffffff)]');
  expect(input.style.borderRadius).toBe('var(--input-radius, 0.375rem)');
  expect(textarea.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(select.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(checkbox.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(message.className).toContain('text-[var(--form-message-text,var(--color-muted-text,#4b5563))]');

  // Rerender with error state
  rerender(
    <FormGroup state="error">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Error message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-error-text,var(--color-error-text,#dc2626))]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-error-border,var(--color-error-text,#dc2626))]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-error-text,var(--color-error-text,#dc2626))]');

  // Rerender with success state
  rerender(
    <FormGroup state="success">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Success message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-success-text,var(--color-status-success-text,#166534))]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-success-border,var(--color-status-success-text,#15803d))]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-success-text,var(--color-status-success-text,#166534))]');

  // Rerender with warning state
  rerender(
    <FormGroup state="warning">
      <Label data-testid="label">Field Label</Label>
      <Input data-testid="input" />
      <FormMessage data-testid="message">Warning message</FormMessage>
    </FormGroup>
  );

  expect(screen.getByTestId('label').className).toContain('text-[var(--form-warning-text,var(--color-warning-text,#78350f))]');
  expect(screen.getByTestId('input').className).toContain('border-[var(--input-warning-border,var(--color-warning-text,#b45309))]');
  expect(screen.getByTestId('message').className).toContain('text-[var(--form-warning-text,var(--color-warning-text,#78350f))]');
});

test('Standalone Input renders outside of FormGroup without throwing', () => {
  render(<Input data-testid="standalone-input" placeholder="Type here..." />);
  const input = screen.getByTestId('standalone-input');

  expect(input).toBeInTheDocument();
  expect(input.id).toBeTruthy();
  expect(input).not.toHaveAttribute('aria-describedby');
  expect(input).toHaveAttribute('aria-invalid', 'false');
  expect(input.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(input.className).toContain('bg-[var(--input-bg,#ffffff)]');
  expect(input.className).toContain('h-10 px-3 py-2 text-sm');
});

test('Standalone Input generates fallback unique identifier with useId when id is omitted, and uses custom id when provided', () => {
  const { rerender } = render(<Input data-testid="input-1" />);
  const input1 = screen.getByTestId('input-1');
  expect(input1.id).toBeTruthy();

  rerender(<Input data-testid="input-1" id="custom-test-id" />);
  expect(input1.id).toBe('custom-test-id');
});

test('Standalone Input applies explicit feedback state styles and aria-invalid', () => {
  const { rerender } = render(<Input data-testid="input" state="default" />);
  let input = screen.getByTestId('input');
  expect(input.className).toContain('border-[var(--input-border,var(--color-surface-border,#6b7280))]');
  expect(input).toHaveAttribute('aria-invalid', 'false');

  rerender(<Input data-testid="input" state="error" />);
  input = screen.getByTestId('input');
  expect(input.className).toContain('border-[var(--input-error-border,var(--color-error-text,#dc2626))]');
  expect(input).toHaveAttribute('aria-invalid', 'true');

  rerender(<Input data-testid="input" state="warning" />);
  input = screen.getByTestId('input');
  expect(input.className).toContain('border-[var(--input-warning-border,var(--color-warning-text,#b45309))]');
  expect(input).toHaveAttribute('aria-invalid', 'false');

  rerender(<Input data-testid="input" state="success" />);
  input = screen.getByTestId('input');
  expect(input.className).toContain('border-[var(--input-success-border,var(--color-status-success-text,#15803d))]');
  expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('Input supports compact and default sizeVariant', () => {
  const { rerender } = render(<Input data-testid="input" sizeVariant="compact" />);
  let input = screen.getByTestId('input');
  expect(input.className).toContain('h-7 px-2 py-1 text-xs');
  expect(input.className).not.toContain('h-10');

  rerender(<Input data-testid="input" sizeVariant="default" />);
  input = screen.getByTestId('input');
  expect(input.className).toContain('h-10 px-3 py-2 text-sm');
  expect(input.className).not.toContain('h-7');
});

test('Input inside FormGroup allows explicit state and sizeVariant prop overrides', () => {
  render(
    <FormGroup state="default">
      <Input data-testid="input-override" state="error" sizeVariant="compact" />
    </FormGroup>
  );
  const input = screen.getByTestId('input-override');
  expect(input.className).toContain('border-[var(--input-error-border,var(--color-error-text,#dc2626))]');
  expect(input.className).toContain('h-7 px-2 py-1 text-xs');
  expect(input).toHaveAttribute('aria-invalid', 'true');
});

test('Custom id props on Input, Textarea, Select, and Checkbox sync with Label inside FormGroup', () => {
  const { rerender } = render(
    <FormGroup>
      <Label>Custom Input Label</Label>
      <Input id="custom-input-id" />
    </FormGroup>
  );
  expect(screen.getByLabelText('Custom Input Label')).toHaveAttribute('id', 'custom-input-id');

  rerender(
    <FormGroup>
      <Label>Custom Textarea Label</Label>
      <Textarea id="custom-textarea-id" />
    </FormGroup>
  );
  expect(screen.getByLabelText('Custom Textarea Label')).toHaveAttribute('id', 'custom-textarea-id');

  rerender(
    <FormGroup>
      <Label>Custom Select Label</Label>
      <Select id="custom-select-id">
        <option value="a">Option A</option>
      </Select>
    </FormGroup>
  );
  expect(screen.getByLabelText('Custom Select Label')).toHaveAttribute('id', 'custom-select-id');

  rerender(
    <FormGroup>
      <Checkbox id="custom-checkbox-id" />
      <Label>Custom Checkbox Label</Label>
    </FormGroup>
  );
  expect(screen.getByLabelText('Custom Checkbox Label')).toHaveAttribute('id', 'custom-checkbox-id');
});

test('Multiple controls inside one FormGroup produce unique non-duplicate id attributes', () => {
  const { container } = render(
    <FormGroup>
      <Label>Primary Input</Label>
      <Input data-testid="ctrl-1" />
      <Input data-testid="ctrl-2" aria-label="Secondary Input" />
      <Select data-testid="ctrl-3" aria-label="Secondary Select">
        <option value="1">One</option>
      </Select>
      <Textarea data-testid="ctrl-4" aria-label="Secondary Textarea" />
      <Checkbox data-testid="ctrl-5" aria-label="Secondary Checkbox" />
    </FormGroup>
  );

  const elementsWithIds = Array.from(container.querySelectorAll('[id]'));
  const ids = elementsWithIds.map((el) => el.id);
  expect(ids.length).toBeGreaterThanOrEqual(5);
  expect(new Set(ids).size).toBe(ids.length);
  expect(screen.getByLabelText('Primary Input')).toBe(screen.getByTestId('ctrl-1'));
});

test('Custom id on FormMessage and caller aria-describedby on controls preserve merged references', () => {
  render(
    <div>
      <p id="external-hint">External hint text</p>
      <FormGroup state="error">
        <Label>Merged Field</Label>
        <Input id="merged-input" aria-describedby="external-hint" />
        <Textarea aria-label="Merged Textarea" aria-describedby="external-hint" />
        <Select aria-label="Merged Select" aria-describedby="external-hint">
          <option value="x">X</option>
        </Select>
        <Checkbox aria-label="Merged Checkbox" aria-describedby="external-hint" />
        <FormMessage id="custom-msg-id">Validation error text</FormMessage>
        <FormMessage id="secondary-msg-id">Additional guidance</FormMessage>
      </FormGroup>
    </div>
  );

  const msg1 = screen.getByText('Validation error text');
  const msg2 = screen.getByText('Additional guidance');
  expect(msg1).toHaveAttribute('id', 'custom-msg-id');
  expect(msg2).toHaveAttribute('id', 'secondary-msg-id');

  const expectedDescribedBy = 'external-hint custom-msg-id secondary-msg-id';
  expect(screen.getByLabelText('Merged Field')).toHaveAttribute('aria-describedby', expectedDescribedBy);
  expect(screen.getByLabelText('Merged Textarea')).toHaveAttribute('aria-describedby', expectedDescribedBy);
  expect(screen.getByLabelText('Merged Select')).toHaveAttribute('aria-describedby', expectedDescribedBy);
  expect(screen.getByLabelText('Merged Checkbox')).toHaveAttribute('aria-describedby', expectedDescribedBy);
});

test('Form primitives report zero jest-axe accessibility violations', async () => {
  const { container } = render(
    <div>
      <p id="ext-help">Helper description</p>
      <FormGroup state="error">
        <Label>Email Address</Label>
        <Input id="axe-email" type="email" aria-describedby="ext-help" />
        <Input aria-label="Backup Email Address" type="email" />
        <FormMessage id="axe-email-error">Please enter a valid email.</FormMessage>
      </FormGroup>
    </div>
  );

  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

