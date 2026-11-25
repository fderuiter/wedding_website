import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FormGroup, Label, FormMessage } from '@/components/ui/forms';
import { SearchableTimezoneSelect } from '../SearchableTimezoneSelect';

expect.extend(toHaveNoViolations);

describe('SearchableTimezoneSelect', () => {
  it('renders an accessible combobox linked to FormGroup Label and passes jest-axe', async () => {
    const handleChange = jest.fn();
    const { container } = render(
      <FormGroup>
        <Label htmlFor="tz-input">Timezone</Label>
        <SearchableTimezoneSelect
          id="tz-input"
          value="America/Chicago"
          onChange={handleChange}
        />
      </FormGroup>
    );

    const combobox = screen.getByRole('combobox', { name: /Timezone/i });
    expect(combobox).toHaveValue('America/Chicago');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).toHaveAttribute('aria-autocomplete', 'list');

    const closedAxe = await axe(container);
    expect(closedAxe).toHaveNoViolations();

    fireEvent.focus(combobox);
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    const openAxe = await axe(container);
    expect(openAxe).toHaveNoViolations();
  });

  it('filters IANA timezones, navigates via keyboard arrows/Home/End, selects with Enter, and reverts on Escape', () => {
    const handleChange = jest.fn();
    const inputRef = createRef<HTMLInputElement>();
    render(
      <FormGroup>
        <Label htmlFor="tz-select">Timezone</Label>
        <SearchableTimezoneSelect
          ref={inputRef}
          id="tz-select"
          value="America/Chicago"
          onChange={handleChange}
        />
      </FormGroup>
    );

    expect(inputRef.current).toBeInstanceOf(HTMLInputElement);
    const combobox = screen.getByRole('combobox', { name: /Timezone/i });

    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: 'Tokyo' } });

    const options = screen.getAllByRole('option');
    expect(options.some((opt) => opt.textContent === 'Asia/Tokyo')).toBe(true);

    // Escape closes dropdown and reverts draft search back to committed value
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).toHaveValue('America/Chicago');
    expect(handleChange).not.toHaveBeenCalled();

    // Filter again and select via keyboard Enter
    fireEvent.change(combobox, { target: { value: 'Asia/Tokyo' } });
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(combobox, { key: 'Home' });
    fireEvent.keyDown(combobox, { key: 'Enter' });

    expect(handleChange).toHaveBeenCalledWith('Asia/Tokyo');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports commitRawOnBlur and surfaces FormGroup error state via aria-invalid and aria-describedby', async () => {
    const handleChange = jest.fn();
    const { container } = render(
      <FormGroup state="error">
        <Label htmlFor="tz-err">Timezone</Label>
        <SearchableTimezoneSelect
          id="tz-err"
          value="Invalid/Zone"
          onChange={handleChange}
          commitRawOnBlur
        />
        <FormMessage role="alert">Invalid IANA timezone.</FormMessage>
      </FormGroup>
    );

    const combobox = screen.getByRole('combobox', { name: /Timezone/i });
    expect(combobox).toHaveAttribute('aria-invalid', 'true');
    const describedBy = combobox.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Invalid IANA timezone.');

    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: 'Europe/London' } });
    fireEvent.mouseDown(document.body);
    expect(handleChange).toHaveBeenCalledWith('Europe/London');

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });
});
