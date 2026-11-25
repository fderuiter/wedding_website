import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  FormGroup,
  Label,
  Input,
  Checkbox,
  Textarea,
  Select,
  FormMessage,
  focusFirstInvalidControl,
} from '../forms';

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

test('FormGroup synchronizes required state across Label, Input, Textarea, Select, and Checkbox with aria-hidden visual asterisk', async () => {
  const { container } = render(
    <div>
      <FormGroup required>
        <Label data-testid="name-label">Your Name</Label>
        <Input data-testid="name-input" autoComplete="name" />
      </FormGroup>
      <FormGroup required>
        <Label data-testid="notes-label">Dietary Notes</Label>
        <Textarea data-testid="notes-textarea" />
      </FormGroup>
      <FormGroup required>
        <Label data-testid="meal-label">Meal Choice</Label>
        <Select data-testid="meal-select" defaultValue="fish">
          <option value="fish">Salmon</option>
          <option value="veg">Risotto</option>
        </Select>
      </FormGroup>
      <FormGroup required className="flex items-center gap-2">
        <Checkbox data-testid="terms-checkbox" />
        <Label data-testid="terms-label">Confirm Attendance</Label>
      </FormGroup>
    </div>
  );

  for (const testId of ['name-input', 'notes-textarea', 'meal-select', 'terms-checkbox']) {
    const control = screen.getByTestId(testId);
    expect(control).toBeRequired();
    expect(control).toHaveAttribute('aria-required', 'true');
  }

  for (const labelId of ['name-label', 'notes-label', 'meal-label', 'terms-label']) {
    const label = screen.getByTestId(labelId);
    expect(label).toHaveAttribute('data-required', 'true');
    const hiddenAsterisk = label.querySelector('[aria-hidden="true"]');
    expect(hiddenAsterisk).not.toBeNull();
    expect(hiddenAsterisk).toHaveTextContent('*');
  }

  expect(await axe(container)).toHaveNoViolations();
});

test('Control-level required prop sets aria-required="true" and synchronizes data-required onto Label', () => {
  render(
    <FormGroup>
      <Label data-testid="code-label">Invitation Code</Label>
      <Input data-testid="code-input" required />
    </FormGroup>
  );

  const input = screen.getByTestId('code-input');
  const label = screen.getByTestId('code-label');

  expect(input).toBeRequired();
  expect(input).toHaveAttribute('aria-required', 'true');
  expect(label).toHaveAttribute('data-required', 'true');
  expect(screen.getByLabelText('Invitation Code')).toBe(input);
});

test('Busy mode sets readOnly and aria-busy on text inputs without dropping focus and guards Select and Checkbox interactions', async () => {
  const onSelectChange = jest.fn();
  const onCheckboxChange = jest.fn();

  const BusyFormHarness = ({ busy }: { busy: boolean }) => (
    <div>
      <FormGroup busy={busy}>
        <Label>Passcode</Label>
        <Input data-testid="busy-input" type="password" defaultValue="secret12" />
      </FormGroup>
      <FormGroup busy={busy}>
        <Label>Personal Message</Label>
        <Textarea data-testid="busy-textarea" defaultValue="Best wishes" />
      </FormGroup>
      <FormGroup busy={busy}>
        <Label>Quantity</Label>
        <Select data-testid="busy-select" defaultValue="1" onChange={onSelectChange}>
          <option value="1">1</option>
          <option value="2">2</option>
        </Select>
      </FormGroup>
      <FormGroup busy={busy}>
        <Checkbox data-testid="busy-checkbox" onChange={onCheckboxChange} />
        <Label>Cover Fee</Label>
      </FormGroup>
    </div>
  );

  const { container, rerender } = render(<BusyFormHarness busy={false} />);

  const input = screen.getByTestId('busy-input') as HTMLInputElement;
  input.focus();
  expect(document.activeElement).toBe(input);

  rerender(<BusyFormHarness busy={true} />);

  // Active text input keeps focus and sets readOnly + aria-busy instead of native disabled
  expect(document.activeElement).toBe(input);
  expect(input).not.toBeDisabled();
  expect(input).toHaveAttribute('readonly');
  expect(input).toHaveAttribute('aria-busy', 'true');

  const textarea = screen.getByTestId('busy-textarea');
  expect(textarea).not.toBeDisabled();
  expect(textarea).toHaveAttribute('readonly');
  expect(textarea).toHaveAttribute('aria-busy', 'true');

  const select = screen.getByTestId('busy-select');
  expect(select).not.toBeDisabled();
  expect(select).toHaveAttribute('aria-busy', 'true');
  expect(select).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(select, { target: { value: '2' } });
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  expect(onSelectChange).not.toHaveBeenCalled();

  const checkbox = screen.getByTestId('busy-checkbox');
  expect(checkbox).not.toBeDisabled();
  expect(checkbox).toHaveAttribute('aria-busy', 'true');
  expect(checkbox).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(checkbox);
  fireEvent.keyDown(checkbox, { key: ' ' });
  expect(onCheckboxChange).not.toHaveBeenCalled();

  expect(await axe(container)).toHaveNoViolations();
});

test('FormGroup group mode names composite widgets via role="group" + aria-labelledby without dangling htmlFor', async () => {
  const { container } = render(
    <FormGroup group>
      <Label>Card &amp; Digital Wallet Details</Label>
      <div data-testid="embedded-widget">Embedded Payment Element</div>
      <FormMessage>Encrypted via TLS</FormMessage>
    </FormGroup>
  );

  const group = screen.getByRole('group', { name: 'Card & Digital Wallet Details' });
  expect(group).toBeInTheDocument();

  const labelEl = container.querySelector('label');
  expect(labelEl).not.toBeNull();
  expect(labelEl).not.toHaveAttribute('for');
  expect(group).toHaveAttribute('aria-labelledby', labelEl?.id);
  expect(await axe(container)).toHaveNoViolations();
});

test('FormGroup as="fieldset" renders semantic fieldset and legend without htmlFor', async () => {
  const { container } = render(
    <FormGroup as="fieldset">
      <Label>Price Range</Label>
      <input type="range" min={0} max={100} defaultValue={20} aria-label="Minimum price" />
      <input type="range" min={0} max={100} defaultValue={80} aria-label="Maximum price" />
    </FormGroup>
  );

  const fieldset = screen.getByRole('group', { name: 'Price Range' });
  expect(fieldset.tagName).toBe('FIELDSET');
  const legend = container.querySelector('legend');
  expect(legend).not.toBeNull();
  expect(legend).toHaveTextContent('Price Range');
  expect(container.querySelector('label[for]')).toBeNull();
  expect(await axe(container)).toHaveNoViolations();
});

test('focusFirstInvalidControl focuses the first visible enabled aria-invalid="true" control and returns null when none are invalid', () => {
  const { container } = render(
    <div>
      <div className="hidden" aria-hidden="true">
        <input data-testid="honeypot-invalid" aria-invalid="true" />
      </div>
      <FormGroup>
        <Label>Valid Name</Label>
        <Input data-testid="valid-input" defaultValue="Jane" />
      </FormGroup>
      <FormGroup state="error">
        <Label>Disabled Invalid</Label>
        <Input data-testid="disabled-invalid" disabled />
      </FormGroup>
      <FormGroup state="error">
        <Label>Meal Choice</Label>
        <Select data-testid="first-invalid-select" defaultValue="">
          <option value="">Choose meal</option>
        </Select>
        <FormMessage>Meal is required</FormMessage>
      </FormGroup>
      <FormGroup state="error">
        <Label>Notes</Label>
        <Textarea data-testid="second-invalid-textarea" />
        <FormMessage>Notes invalid</FormMessage>
      </FormGroup>
    </div>
  );

  const focused = focusFirstInvalidControl(container);
  const firstInvalid = screen.getByTestId('first-invalid-select');
  expect(focused).toBe(firstInvalid);
  expect(document.activeElement).toBe(firstInvalid);

  const validContainer = document.createElement('div');
  expect(focusFirstInvalidControl(validContainer)).toBeNull();
});

test('FormGroup guards against silent htmlFor collisions when multiple unlabelled controls or multiple unkeyed Labels share a non-group FormGroup', () => {
  const { container } = render(
    <div>
      <FormGroup>
        <Checkbox data-testid="colliding-cb-1" />
        <Label data-testid="colliding-label-1">Decorative Image</Label>
        <Checkbox data-testid="colliding-cb-2" />
        <Label data-testid="colliding-label-2">Publish to Gallery</Label>
      </FormGroup>
      <FormGroup>
        <Checkbox data-testid="isolated-cb-1" />
        <Label data-testid="isolated-label-1">Isolated Decorative</Label>
      </FormGroup>
      <FormGroup>
        <Checkbox data-testid="isolated-cb-2" />
        <Label data-testid="isolated-label-2">Isolated Publish</Label>
      </FormGroup>
    </div>
  );

  // Guard omits silent htmlFor fallback to controls[0] when multiple unlabelled controls share one non-group FormGroup
  expect(screen.getByTestId('colliding-label-1')).not.toHaveAttribute('for');
  expect(screen.getByTestId('colliding-label-2')).not.toHaveAttribute('for');
  expect(container.querySelectorAll('label[for]')).toHaveLength(2);

  // Separate FormGroups bind each Label cleanly to its own Checkbox
  const cb1 = screen.getByTestId('isolated-cb-1') as HTMLInputElement;
  const cb2 = screen.getByTestId('isolated-cb-2') as HTMLInputElement;
  expect(cb1.checked).toBe(false);
  expect(cb2.checked).toBe(false);

  fireEvent.click(screen.getByTestId('isolated-label-2'));
  expect(cb1.checked).toBe(false);
  expect(cb2.checked).toBe(true);
});


